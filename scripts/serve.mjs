// 仅用于开发预览静态文件；发给使用者的单文件 HTML 不需要此进程。
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 58700);
http.createServer(async (request, response) => {
  console.log(request.method, request.url);
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = pathname === '/' || pathname === '/index.html' ? 'index.html'
    : pathname === '/LICENSE.upstream' ? 'LICENSE.upstream'
    : pathname === '/version.json' ? 'version.json' : /^\/ocr-assets\/[a-f0-9]{16}\/(?:core\/|lang\/|licenses\/)?[a-zA-Z0-9_.@-]+$/.test(pathname) ? pathname.slice(1) : null;
  if (!file) { response.writeHead(404); response.end(); return; }
  try {
    const bytes = await readFile(root + file);
    response.writeHead(200, {'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.gz') ? 'application/gzip' : file.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Static preview: http://127.0.0.1:${port}`));
