'use strict';

const $ = (id) => document.getElementById(id);
const isWin = window.api.platform === 'win32';

/** Mỗi dòng: { id, path, dir, name, newName, base, checked, result }
 *  base: tên gốc nháp mà các thao tác ở trên áp dụng lên (tên đã gõ/dán, mặc định là tên hiện tại) */
let rows = [];
let nextId = 1;
let undoOps = null; // [{ path, newName }] để đổi ngược lại lần đổi tên gần nhất

// ---------- Tiện ích tên file ----------

function splitExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

/** Áp dụng fn lên phần tên (bỏ qua phần mở rộng nếu đang bật "giữ nguyên") */
function transform(name, fn) {
  if (!$('keepExt').checked) return fn(name);
  const [stem, ext] = splitExt(name);
  return fn(stem) + ext;
}

const INVALID_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const key = (dir, name) => {
  const k = dir + '/' + name;
  return isWin ? k.toLowerCase() : k;
};

/** Phần tên hiển thị trong ô nhập (không gồm đuôi file đang bị khoá) */
function editablePart(r) {
  return r.lockedExt && r.newName.endsWith(r.lockedExt)
    ? r.newName.slice(0, -r.lockedExt.length)
    : r.newName;
}

/** Trả về Map id -> thông báo lỗi */
function validate() {
  const errors = new Map();
  const count = new Map();
  for (const r of rows) {
    const k = key(r.dir, r.newName);
    count.set(k, (count.get(k) || 0) + 1);
  }
  for (const r of rows) {
    const n = r.newName;
    let err = null;
    if (!n.trim() || !editablePart(r).trim()) err = 'Tên trống';
    else if (n !== r.name && /^\.[^.]*$/.test(n)) err = 'Tên trống (chỉ còn đuôi file)';
    else if (INVALID_CHARS.test(n)) err = 'Chứa ký tự không hợp lệ \\ / : * ? " < > |';
    else if (/[. ]$/.test(n)) err = 'Không được kết thúc bằng dấu chấm/khoảng trắng';
    else if (RESERVED.test(n)) err = 'Tên bị Windows dành riêng';
    else if (n === '.' || n === '..') err = 'Tên không hợp lệ';
    else if (count.get(key(r.dir, n)) > 1) err = 'Trùng tên với file khác';
    if (err) errors.set(r.id, err);
  }
  return errors;
}

// ---------- Hiển thị ----------

const timeFormat = {
  format(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
};

function render() {
  const tbody = $('rows');
  tbody.replaceChildren();

  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;

    const tdCheck = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = r.checked;
    cb.tabIndex = -1; // Tab đi thẳng từ ô tên này sang ô tên dòng sau
    cb.addEventListener('change', () => {
      r.checked = cb.checked;
      updateCheckAll();
    });
    tdCheck.append(cb);

    const tdIdx = document.createElement('td');
    tdIdx.textContent = i + 1;
    tdIdx.className = 'muted';

    const tdName = document.createElement('td');
    tdName.className = 'name';
    tdName.title = r.path;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = r.name;
    const dirSpan = document.createElement('span');
    dirSpan.className = 'dir';
    dirSpan.textContent = r.dir;
    tdName.append(nameSpan, dirSpan);

    // Khi "giữ nguyên phần mở rộng" bật, ô nhập chỉ chứa phần tên, đuôi file hiện cố định bên cạnh
    r.lockedExt = $('keepExt').checked ? splitExt(r.newName)[1] : '';
    const tdNew = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'newname-wrap';
    const input = document.createElement('input');
    input.className = 'newname';
    input.value = editablePart(r);
    input.spellcheck = false;
    // Click vào ô lần đầu thì chọn hết tên; click tiếp thì đặt con trỏ như bình thường
    let clickToFocus = false;
    input.addEventListener('mousedown', () => (clickToFocus = document.activeElement !== input));
    input.addEventListener('focus', () => input.select());
    input.addEventListener('mouseup', (e) => {
      if (clickToFocus) e.preventDefault(); // không để thả chuột bỏ vùng chọn
      clickToFocus = false;
    });
    // Dán nhiều dòng: dòng 1 vào ô này, các dòng sau lần lượt vào các file bên dưới
    input.addEventListener('paste', (e) => {
      const lines = e.clipboardData
        .getData('text')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length < 2) return; // một dòng thì dán bình thường
      e.preventDefault();
      pasteNames(rows.indexOf(r), lines);
    });
    input.addEventListener('input', () => {
      r.base = r.newName = input.value + r.lockedExt;
      r.result = null;
      refreshStatus();
    });
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = r.lockedExt;
    wrap.append(input, ext);
    tdNew.append(wrap);

    const tdTime = document.createElement('td');
    tdTime.className = 'muted time';
    tdTime.textContent = timeFormat.format(r.mtime);

    const tdStatus = document.createElement('td');
    tdStatus.className = 'status';

    tr.append(tdCheck, tdIdx, tdTime, tdName, tdNew, tdStatus);
    tbody.append(tr);
  });

  $('empty').hidden = rows.length > 0;
  updateCheckAll();
  refreshStatus();
}

/** Cập nhật trạng thái từng dòng mà không dựng lại ô nhập (tránh mất con trỏ khi gõ) */
function refreshStatus() {
  const errors = validate();
  let changed = 0;

  for (const tr of $('rows').children) {
    const r = rows.find((x) => x.id === Number(tr.dataset.id));
    const status = tr.querySelector('.status');
    const input = tr.querySelector('input.newname');
    if (input.value !== editablePart(r)) input.value = editablePart(r);

    const err = errors.get(r.id);
    const isChanged = r.newName !== r.name;
    if (isChanged && !err) changed++;

    tr.classList.toggle('invalid', !!err);
    tr.classList.toggle('changed', isChanged && !err);

    if (err) {
      status.textContent = err;
      status.className = 'status status-error';
    } else if (r.result) {
      status.textContent = r.result.msg;
      status.className = 'status ' + (r.result.ok ? 'status-ok' : 'status-error');
    } else {
      status.textContent = isChanged ? 'Chưa lưu' : '';
      status.className = 'status muted';
    }
  }

  const parts = [`${rows.length} file`, `${changed} chưa lưu`];
  if (errors.size) parts.push(`${errors.size} lỗi`);
  $('summary').textContent = parts.join(' · ');
  $('btnApply').textContent = changed ? `Lưu (${changed} file)` : 'Lưu';
  $('btnApply').disabled = changed === 0 || errors.size > 0;
  $('btnUndo').disabled = !undoOps;
}

function updateCheckAll() {
  const all = $('checkAll');
  const n = rows.filter((r) => r.checked).length;
  all.checked = rows.length > 0 && n === rows.length;
  all.indeterminate = n > 0 && n < rows.length;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 7000 : 3500);
}

function pasteNames(start, lines) {
  const targets = rows.slice(start, start + lines.length);
  targets.forEach((r, i) => {
    r.base = r.newName = lines[i] + r.lockedExt;
    r.result = null;
  });
  render();
  const extra = lines.length - targets.length;
  if (extra > 0) toast(`Đã dán ${targets.length} tên. Thừa ${extra} dòng vì không đủ file bên dưới`, true);
  else toast(`Đã dán ${targets.length} tên`);
}

// ---------- Thêm / bớt file ----------

function addFiles(files) {
  const existing = new Set(rows.map((r) => key(r.dir, r.name)));
  let added = 0;
  for (const f of files) {
    if (existing.has(key(f.dir, f.name))) continue;
    existing.add(key(f.dir, f.name));
    rows.push({ id: nextId++, ...f, newName: f.name, base: f.name, checked: true, result: null });
    added++;
  }
  render();
  if (files.length && added < files.length) toast(`Đã bỏ qua ${files.length - added} file đã có trong danh sách`);
}

$('btnPick').addEventListener('click', async () => addFiles(await window.api.pickFiles()));

$('btnRemove').addEventListener('click', () => {
  rows = rows.filter((r) => !r.checked);
  render();
});

// Mỗi lần bấm đổi chiều: cũ → mới, rồi mới → cũ
let sortNewestFirst = false;
$('btnSort').addEventListener('click', () => {
  const dir = sortNewestFirst ? -1 : 1;
  rows.sort((a, b) => dir * (a.mtime - b.mtime));
  sortNewestFirst = !sortNewestFirst;
  $('btnSort').textContent = sortNewestFirst ? 'Sắp xếp: mới → cũ' : 'Sắp xếp: cũ → mới';
  render();
});

$('checkAll').addEventListener('change', (e) => {
  rows.forEach((r) => (r.checked = e.target.checked));
  render();
});

// Kéo thả file vào danh sách
const drop = $('dropZone');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('dragover');
});
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('dragover');
  const paths = [...e.dataTransfer.files].map((f) => window.api.getPathForFile(f)).filter(Boolean);
  addFiles(await window.api.describePaths(paths));
});

// ---------- Thao tác hàng loạt ----------

function applyToChecked(fn) {
  const targets = rows.filter((r) => r.checked);
  if (!targets.length) {
    toast('Hãy tích chọn ít nhất một file', true);
    return 0;
  }
  targets.forEach((r, i) => {
    r.newName = fn(r, i);
    r.result = null;
  });
  render();
  return targets.length;
}

$('keepExt').addEventListener('change', render);

const OP_INPUTS = ['delStart', 'delEnd', 'find', 'replace', 'prefix', 'suffix'];

function readOps() {
  const count = (id) => Math.max(0, parseInt($(id).value, 10) || 0);
  return {
    delStart: count('delStart'),
    delEnd: count('delEnd'),
    find: $('find').value,
    replace: $('replace').value,
    prefix: $('prefix').value,
    suffix: $('suffix').value,
  };
}

/** Chạy lần lượt: xóa ký tự → tìm và thay → thêm đầu/cuối */
function runOps(s, o) {
  s = s.slice(o.delStart);
  s = s.slice(0, Math.max(0, s.length - o.delEnd));
  if (o.find) s = s.split(o.find).join(o.replace);
  return o.prefix + s + o.suffix;
}

// Xác nhận: tạo tên nháp từ tên gốc nháp (r.base = tên đã gõ/dán, hoặc tên hiện tại nếu chưa gõ),
// nên bấm lại nhiều lần vẫn ra cùng kết quả.
// Chưa đổi gì trên ổ đĩa cho tới khi bấm Lưu.
$('btnConfirm').addEventListener('click', () => {
  const o = readOps();
  if (!o.delStart && !o.delEnd && !o.find && !o.prefix && !o.suffix) {
    return toast('Chưa nhập thao tác nào', true);
  }
  const n = applyToChecked((r) => transform(r.base, (s) => runOps(s, o)));
  if (n) toast(`Đã tạo tên nháp cho ${n} file. Kiểm tra rồi bấm "Lưu" để đổi tên thật`);
});

$('btnResetNames').addEventListener('click', () => applyToChecked((r) => (r.base = r.name)));

// Enter trong ô thao tác = bấm Xác nhận
for (const id of OP_INPUTS) {
  $(id).addEventListener('keydown', (e) => e.key === 'Enter' && $('btnConfirm').click());
}

// ---------- Đổi tên thật ----------

async function runRename(ops, isUndo) {
  $('btnApply').disabled = true;
  $('btnUndo').disabled = true;
  const res = await window.api.renameFiles(ops.map((o) => ({ from: o.path, newName: o.newName })));
  // Tra dòng theo đường dẫn cũ trước khi cập nhật (khi hoán đổi tên, đường dẫn mới của dòng này trùng đường dẫn cũ của dòng kia)
  const rowByPath = new Map(rows.map((r) => [r.path, r]));

  if (res.errors && res.errors.length) {
    for (const e of res.errors) {
      const r = rowByPath.get(e.from);
      if (r) r.result = { ok: false, msg: e.error };
    }
    refreshStatus();
    const lines = res.errors.slice(0, 3).map((e) => {
      const r = rowByPath.get(e.from);
      return `• ${r ? r.name : e.from}: ${e.error}`;
    });
    if (res.errors.length > 3) lines.push(`… và ${res.errors.length - 3} file khác (xem cột Trạng thái)`);
    toast('Chưa đổi tên file nào.\n' + lines.join('\n'), true);
    return;
  }

  const newNameByPath = new Map(ops.map((o) => [o.path, o.newName]));
  const newUndo = [];
  let ok = 0;
  for (const result of res.results) {
    const r = rowByPath.get(result.from);
    if (!r) continue;
    if (result.ok) {
      const oldName = r.name;
      r.path = result.to;
      r.name = r.newName = r.base = newNameByPath.get(result.from);
      r.result = { ok: true, msg: isUndo ? 'Đã hoàn tác' : `Đã đổi (từ "${oldName}")` };
      newUndo.push({ path: r.path, newName: oldName });
      ok++;
    } else {
      r.result = { ok: false, msg: result.error };
    }
  }
  undoOps = isUndo ? null : newUndo.length ? newUndo : null;
  render();

  const failed = res.results.length - ok;
  if (failed) toast(`Đã đổi ${ok} file, lỗi ${failed} file`, true);
  else toast(isUndo ? `Đã hoàn tác ${ok} file` : `Đã đổi tên ${ok} file`);
}

/** Hỏi lại trước khi đổi tên thật. Trả về true nếu bấm Đồng ý. */
function confirmRename(changed) {
  const PREVIEW = 5;
  $('confirmTitle').textContent = `Đổi tên ${changed.length} file?`;
  $('confirmList').replaceChildren(
    ...changed.slice(0, PREVIEW).map((r) => {
      const li = document.createElement('li');
      const from = document.createElement('span');
      from.className = 'muted';
      from.textContent = r.name;
      const to = document.createElement('b');
      to.textContent = r.newName;
      li.append(from, ' → ', to);
      li.title = `${r.name} → ${r.newName}`;
      return li;
    })
  );
  $('confirmMore').textContent = changed.length > PREVIEW ? `… và ${changed.length - PREVIEW} file khác` : '';

  const dlg = $('confirmDlg');
  dlg.showModal();
  return new Promise((resolve) => (confirmResolve = resolve));
}

// Trả lời hộp thoại xác nhận trực tiếp từ nút bấm / phím Esc (không chờ sự kiện 'close')
let confirmResolve = null;
function answerConfirm(ok) {
  const dlg = $('confirmDlg');
  if (dlg.open) dlg.close();
  if (confirmResolve) confirmResolve(ok);
  confirmResolve = null;
}
for (const btn of $('confirmDlg').querySelectorAll('button')) {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    answerConfirm(btn.value === 'ok');
  });
}
$('confirmDlg').addEventListener('cancel', (e) => {
  e.preventDefault();
  answerConfirm(false);
});
$('confirmDlg').addEventListener('close', () => answerConfirm(false));

$('btnApply').addEventListener('click', async () => {
  const changed = rows.filter((r) => r.newName !== r.name);
  if (!changed.length || !(await confirmRename(changed))) return;
  runRename(changed.map((r) => ({ path: r.path, newName: r.newName })), false);
});

$('btnUndo').addEventListener('click', () => {
  if (undoOps) runRename(undoOps, true);
});

render();
