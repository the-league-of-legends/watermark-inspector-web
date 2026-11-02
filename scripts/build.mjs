import {readFile, writeFile, mkdir, copyFile, readdir, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(path.join(root, 'src', name), 'utf8');
const [html, style, codec, worker, app, local, regions, fields, version, layout, schema] = await Promise.all(
  ['index.html', 'style.css', 'codec.js', 'worker.js', 'app.js', 'local-analysis.js', 'regions.js', 'fields.js', 'version.js', 'region-layout.js', 'schema.js'].map(read));
const bundledRules = [JSON.parse(await readFile(path.join(root,'watermark.schema.json'),'utf8'))];
const visible = await read('visible-text.js'), visibleBrowser=await read('visible-browser.js'), supervisor=await read('ocr-supervisor.js');
const analysis=JSON.parse(await readFile(path.join(root,'watermark.analysis.json'),'utf8'));
const assets=[];
for(const [source,target] of [['tesseract.js/dist/tesseract.min.js','tesseract.min.js'],['tesseract.js/dist/worker.min.js','worker.min.js'],['@tesseract.js-data/eng/4.0.0/eng.traineddata.gz','lang/eng.traineddata.gz']])assets.push([source,target]);
for(const name of (await readdir(path.join(root,'node_modules/tesseract.js-core'))).sort())if(/^tesseract-core.*\.(js|wasm)$/.test(name))assets.push(['tesseract.js-core/'+name,'core/'+name]);
for(const pkgName of ['tesseract.js','tesseract.js-core','@tesseract.js-data/eng'])for(const name of (await readdir(path.join(root,'node_modules',pkgName))).sort())if(/^LICENSE/i.test(name))assets.push([pkgName+'/'+name,'licenses/'+pkgName.replaceAll('/','-')+'-'+name]);
assets.sort((a,b)=>a[1].localeCompare(b[1],'en'));
const scriptJSON=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const assetHash=createHash('sha256');for(const [source,target]of assets)assetHash.update(target).update(await readFile(path.join(root,'node_modules',source)));
const ocrAssetId=assetHash.digest('hex').slice(0,16);
const license = await readFile(path.join(root, 'LICENSE.upstream'), 'utf8');
const notice = '/*!\n' + license + '\n*/\n';
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const buildInfo = {buildId: createHash('sha256').update(JSON.stringify([html, style, codec, worker, app, local, regions, fields, version, layout, schema, bundledRules, visible, visibleBrowser, supervisor, analysis, ocrAssetId, pkg.version])).digest('hex').slice(0,16), version: pkg.version, ocrAssetId, ocr:{engine:"tesseract.js",version:"7.0.0",assets:assets.map(([,name])=>name)}, protocols: createRequire(import.meta.url)('../src/codec.js').supportedProtocols};
const workerSource = notice + schema + '\n' + codec + '\n' + worker;
const runtime = notice + 'const OCR_SUPERVISOR_SOURCE = '+JSON.stringify(supervisor).replaceAll('<','\\u003c')+';\n'+'const BUNDLED_ANALYSIS = '+scriptJSON(analysis)+';\n'+visible+'\n'+'const BUNDLED_RULES = '+scriptJSON(bundledRules)+';\n' + 'const BUILD_INFO = ' + JSON.stringify(buildInfo) + ';\n' + schema + '\n' + codec + '\n' + fields + '\n' + layout + '\nconst WORKER_SOURCE = ' + JSON.stringify(workerSource).replaceAll('<', '\\u003c')
  + ';\n' + app.replace('/*__LOCAL_ANALYSIS__*/', local).replace('/*__VISIBLE_BROWSER__*/',visibleBrowser) + '\n' + regions + '\n' + version;
const output = html.replace('__STYLE__', style).replace('__SCRIPTS__', '<script>\n' + runtime + '\n</script>');
// 产物不能意外保留本机服务地址或 Python API 调用。
for (const forbidden of ['/api/', 'loadImage(', '__LOCAL_ANALYSIS__', '__SCRIPTS__']) {
  if (output.includes(forbidden)) throw Error('Unexpected runtime dependency: ' + forbidden);
}
if ((output.match(/\bfetch\(/g) || []).length !== 1 || !version.includes("new URL('./version.json', location.href)")) throw Error('Only the same-origin version check may use fetch');
await mkdir(path.join(root, 'dist'), {recursive: true});
await rm(path.join(root,'dist','ocr-assets'),{recursive:true,force:true});
const assetRoot=path.join(root,'dist','ocr-assets',ocrAssetId);
for(const [source,target]of assets){await mkdir(path.dirname(path.join(assetRoot,target)),{recursive:true});await copyFile(path.join(root,'node_modules',source),path.join(assetRoot,target));}
await writeFile(path.join(root, 'dist', 'index.html'), output);
await writeFile(path.join(root, 'dist', 'LICENSE.upstream'), await readFile(path.join(root, 'LICENSE.upstream')));
await writeFile(path.join(root, 'dist', 'version.json'), JSON.stringify(buildInfo, null, 2));
console.log(`Built dist/index.html: ${Buffer.byteLength(output)} bytes; local decoder; optional same-origin version check.`);
