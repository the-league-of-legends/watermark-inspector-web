import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(path.join(root, 'src', name), 'utf8');
const [html, style, codec, worker, app, local, regions] = await Promise.all(
  ['index.html', 'style.css', 'codec.js', 'worker.js', 'app.js', 'local-analysis.js', 'regions.js'].map(read));
const license = await readFile(path.join(root, 'LICENSE.upstream'), 'utf8');
const notice = '/*!\n' + license + '\n*/\n';
const workerSource = notice + codec + '\n' + worker;
const runtime = notice + codec + '\nconst WORKER_SOURCE = ' + JSON.stringify(workerSource).replaceAll('<', '\\u003c')
  + ';\n' + app.replace('/*__LOCAL_ANALYSIS__*/', local) + '\n' + regions;
const output = html.replace('__STYLE__', style).replace('__SCRIPTS__', '<script>\n' + runtime + '\n</script>');
// 产物不能意外保留本机服务地址或 Python API 调用。
for (const forbidden of ['127.0.0.1', '/api/', 'loadImage(', 'fetch(', '__LOCAL_ANALYSIS__', '__SCRIPTS__']) {
  if (output.includes(forbidden)) throw Error('Unexpected runtime dependency: ' + forbidden);
}
await mkdir(path.join(root, 'dist'), {recursive: true});
await writeFile(path.join(root, 'dist', 'index.html'), output);
await writeFile(path.join(root, 'dist', 'LICENSE.upstream'), await readFile(path.join(root, 'LICENSE.upstream')));
console.log(`Built dist/index.html: ${Buffer.byteLength(output)} bytes; no runtime dependencies.`);
