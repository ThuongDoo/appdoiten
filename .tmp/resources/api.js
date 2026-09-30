// Thay cho preload.js + main.js + rename.js của bản Electron:
// cung cấp window.api với cùng các hàm, dùng API của Neutralinojs.
'use strict';

Neutralino.init();

(() => {
  const isWin = window.NL_OS === 'Windows';

  const lastSep = (p) => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const dirname = (p) => {
    const i = lastSep(p);
    return i < 0 ? '' : p.slice(0, i) || p.slice(0, 1);
  };
  const basename = (p) => p.slice(lastSep(p) + 1);
  const join = (dir, name) => (/[\\/]$/.test(dir) ? dir + name : dir + (dir.includes('\\') ? '\\' : '/') + name);
  const norm = (p) => {
    const s = p.replace(/\\/g, '/');
    return isWin ? s.toLowerCase() : s;
  };

  async function stats(p) {
    try {
      return await Neutralino.filesystem.getStats(p);
    } catch {
      return null;
    }
  }

  // PowerShell -EncodedCommand nhận script dạng base64 của UTF-16LE (giữ đúng tên file tiếng Việt)
  function encodePowerShell(script) {
    let bin = '';
    for (let i = 0; i < script.length; i++) {
      const c = script.charCodeAt(i);
      bin += String.fromCharCode(c & 0xff, c >> 8);
    }
    return btoa(bin);
  }

  /**
   * Ngày sửa đổi (ms) của các file. Trên Windows, filesystem.getStats của Neutralino trả
   * về thời điểm thay đổi thông tin file (đổi tên cũng làm nó thay đổi) chứ không phải
   * "Date modified" thật, nên lấy qua PowerShell.
   */
  async function modifiedTimes(paths, statList) {
    if (!isWin) return statList.map((st) => st.modifiedAt);
    const out = [];
    const CHUNK = 40; // giữ dòng lệnh dưới giới hạn độ dài của Windows
    for (let i = 0; i < paths.length; i += CHUNK) {
      const part = paths.slice(i, i + CHUNK);
      const list = part.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
      const script =
        `foreach ($p in @(${list})) { try { ` +
        `[DateTimeOffset]::new([IO.File]::GetLastWriteTimeUtc($p)).ToUnixTimeMilliseconds() } catch { 0 } }`;
      let lines = [];
      try {
        const r = await Neutralino.os.execCommand(
          `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShell(script)}`
        );
        lines = r.stdOut.trim().split(/\r?\n/);
      } catch {
        // lỗi thì dùng giá trị của getStats bên dưới
      }
      part.forEach((_, k) => out.push(Number(lines[k]) || statList[i + k].modifiedAt));
    }
    return out;
  }

  // Trả về thông tin các đường dẫn là file (bỏ qua thư mục)
  async function describePaths(paths) {
    const files = [];
    const statList = [];
    for (const p of paths) {
      const st = await stats(p);
      if (st && st.isFile) {
        files.push(p);
        statList.push(st);
      }
    }
    const times = await modifiedTimes(files, statList);
    return files.map((p, i) => ({ path: p, dir: dirname(p), name: basename(p), mtime: times[i] }));
  }

  async function pickFiles() {
    const paths = await Neutralino.os.showOpenDialog('Chọn file cần đổi tên', { multiSelections: true });
    return describePaths(paths || []);
  }

  // Neutralino không cho biết lý do cụ thể; lý do thường gặp nhất là file đang mở (vd. trong Excel)
  const errMsg = () =>
    'Không đổi tên được. File có thể đang mở trong chương trình khác (Excel, Word…), hãy đóng file rồi bấm Lưu lại';

  // File có thể chỉ bị khóa chốc lát (diệt virus, OneDrive đang quét…) nên thử lại vài lần
  async function moveRetry(from, to) {
    for (let i = 0; ; i++) {
      try {
        return await Neutralino.filesystem.move(from, to);
      } catch (err) {
        if (i >= 4) throw err;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }

  /**
   * Đổi tên nhiều file cùng lúc — cùng cách làm với rename.js của bản Electron:
   * kiểm tra trước (có lỗi thì không đổi file nào), rồi đổi qua tên tạm 2 bước.
   * Lưu ý: filesystem.move ghi đè file đích nếu đã tồn tại, nên bước kiểm tra là bắt buộc.
   */
  async function renameFiles(ops) {
    const jobs = ops
      .map((op) => ({ from: op.from, to: join(dirname(op.from), op.newName) }))
      .filter((j) => j.from !== j.to);

    if (jobs.length === 0) return { ok: true, results: [] };

    // Kiểm tra trước
    const sources = new Set(jobs.map((j) => norm(j.from)));
    const targets = new Set();
    const errors = [];
    for (const j of jobs) {
      if (!(await stats(j.from))) {
        errors.push({ from: j.from, error: 'File gốc không còn tồn tại' });
        continue;
      }
      const key = norm(j.to);
      if (targets.has(key)) {
        errors.push({ from: j.from, error: 'Trùng tên với file khác trong danh sách' });
        continue;
      }
      targets.add(key);
      if (!sources.has(key) && (await stats(j.to))) {
        errors.push({ from: j.from, error: 'Đã có file cùng tên trong thư mục' });
      }
    }
    if (errors.length) return { ok: false, errors, results: [] };

    // Bước 1: đổi sang tên tạm. Thử hết các file để báo đủ những file đang bị khóa một lần.
    const stamp = Date.now().toString(36);
    const moved = [];
    const failed = [];
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      j.temp = join(dirname(j.from), `.__doiten_${stamp}_${i}.tmp`);
      try {
        await moveRetry(j.from, j.temp);
        moved.push(j);
      } catch (err) {
        failed.push({ from: j.from, error: errMsg(err) });
      }
    }
    if (failed.length) {
      // Hoàn tác các file đã đổi sang tên tạm, không đổi file nào
      for (const j of moved) await moveRetry(j.temp, j.from).catch(() => {});
      return { ok: false, errors: failed, results: [] };
    }

    // Bước 2: đổi từ tên tạm sang tên mới
    const results = [];
    for (const j of jobs) {
      try {
        await moveRetry(j.temp, j.to);
        results.push({ from: j.from, to: j.to, ok: true });
      } catch (err) {
        // Không đổi được thì cố trả về tên cũ
        const restored = await moveRetry(j.temp, j.from).then(() => true, () => false);
        results.push({
          from: j.from,
          to: j.to,
          ok: false,
          error: errMsg(err) + (restored ? '' : ` (file đang ở tên tạm: ${j.temp})`),
        });
      }
    }
    return { ok: results.every((r) => r.ok), results, errors: [] };
  }

  window.api = {
    pickFiles,
    describePaths,
    renameFiles,
    getPathForFile: () => '', // WebView không cho biết đường dẫn file kéo thả vào
    platform: isWin ? 'win32' : window.NL_OS.toLowerCase(),
  };
})();
