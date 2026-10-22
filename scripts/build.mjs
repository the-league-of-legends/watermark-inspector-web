import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(path.join(root, 'src', name), 'utf8');
const [html, style, codec, worker, app, local, regions, fields, version] = await Promise.all(
  ['index.html', 'style.css', 'codec.js', 'worker.js', 'app.js', 'local-analysis.js', 'regions.js', 'fields.js', 'version.js'].map(read));
const license = await readFile(path.join(root, 'LICENSE.upstream'), 'utf8');
const notice = '/*!\n' + license + '\n*/\n';
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const buildInfo = {buildId: createHash('sha256').update(JSON.stringify([html, style, codec, worker, app, local, regions, fields, version, pkg.version])).digest('hex').slice(0,16), version: pkg.version, protocols: createRequire(import.meta.url)('../src/codec.js').supportedProtocols};
const workerSource = notice + codec + '\n' + worker;
const runtime = notice + 'const BUILD_INFO = ' + JSON.stringify(buildInfo) + ';\n' + codec + '\n' + fields + '\nconst WORKER_SOURCE = ' + JSON.stringify(workerSource).replaceAll('<', '\\u003c')
  + ';\n' + app.replace('/*__LOCAL_ANALYSIS__*/', local) + '\n' + regions + '\n' + version;
const output = html.replace('__STYLE__', style).replace('__SCRIPTS__', '<script>\n' + runtime + '\n</script>');
// 产物不能意外保留本机服务地址或 Python API 调用。
for (const forbidden of ['/api/', 'loadImage(', '__LOCAL_ANALYSIS__', '__SCRIPTS__']) {
  if (output.includes(forbidden)) throw Error('Unexpected runtime dependency: ' + forbidden);
}
if ((output.match(/\bfetch\(/g) || []).length !== 1 || !version.includes("new URL('./version.json', location.href)")) throw Error('Only the same-origin version check may use fetch');
await mkdir(path.join(root, 'dist'), {recursive: true});
await writeFile(path.join(root, 'dist', 'index.html'), output);
await writeFile(path.join(root, 'dist', 'LICENSE.upstream'), await readFile(path.join(root, 'LICENSE.upstream')));
await writeFile(path.join(root, 'dist', 'version.json'), JSON.stringify(buildInfo, null, 2));
console.log(`Built dist/index.html: ${Buffer.byteLength(output)} bytes; local decoder; optional same-origin version check.`);
