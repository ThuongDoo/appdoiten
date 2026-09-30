// Chép giao diện dùng chung (../renderer) vào resources/ và gắn phần API của Neutralino.
// Chạy: node build.js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'renderer');
const out = path.join(__dirname, 'resources');

function replaceOnce(text, from, to) {
  if (!text.includes(from)) throw new Error(`Không tìm thấy trong index.html: ${from}`);
  return text.replace(from, to);
}

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
html = replaceOnce(
  html,
  '<script src="app.js"></script>',
  '<script src="js/neutralino.js"></script>\n    <script src="api.js"></script>\n    <script src="app.js"></script>'
);
// Neutralino giao tiếp với phần native qua WebSocket tới 127.0.0.1
html = replaceOnce(html, "script-src 'self'", "script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*");
// Bản này không hỗ trợ kéo thả file
html = replaceOnce(html, ' hoặc kéo thả file vào đây', '');

fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(src, 'app.js'), path.join(out, 'app.js'));
fs.copyFileSync(path.join(src, 'style.css'), path.join(out, 'style.css'));
fs.copyFileSync(path.join(__dirname, 'src', 'api.js'), path.join(out, 'api.js'));
console.log('Đã chuẩn bị resources/');
