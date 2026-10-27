// 本文件只使用用户选定的图片像素，不使用文件名、账号缓存、本机日志或网络。
let activeWorker = null, rejectActive = null, lastInputFile=null;
let projectRules=[];
const workerURL = URL.createObjectURL(new Blob([WORKER_SOURCE], {type: 'text/javascript'}));

function decodeInWorker(data, width, height, turn) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerURL);
    activeWorker = worker;
    rejectActive = error => finish(error);
    const timer = setTimeout(() => finish(Error('处理超过时限，未返回账号')), 65000);
    function finish(error, value) {
      clearTimeout(timer);
      worker.terminate();
      if (activeWorker === worker) { activeWorker = null; rejectActive = null; }
      error ? reject(error) : resolve(value);
    }
    worker.onmessage = event => {
      if (turn !== generation) return;
      const message = event.data;
      if (message.type === 'progress') $('busytext').textContent = message.stage + '… 图片在浏览器内处理';
      if (message.type === 'result') finish(null, message.result);
      if (message.type === 'error') finish(Error(message.error));
    };
    worker.onerror = () => finish(Error('当前浏览器限制了解码后台任务，请换浏览器或在静态 HTTPS 页面打开'));
    worker.postMessage({buffer: data.buffer, width, height, rules: projectRules}, [data.buffer]);
  });
}

async function readLocalImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(Error('无法读取图片，请使用有效的 PNG / JPEG / WebP / BMP 图片'));
      value.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 12000000) throw Error('图片超过1200万像素，请先缩小');
    return {image, url};
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

function cancelAnalysis() {
  generation++;
  if (activeWorker) activeWorker.terminate();
  if (rejectActive) rejectActive(Error('cancelled'));
  activeWorker = rejectActive = null;
  setBusy(false);
}

function clearImage() {
  cancelAnalysis();
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
  original = reference = overlay = pixels = residual = chroma = result = null;
  resetRegions();
  lastInputFile=null;
  renderPayload([]);
  $('details').textContent='';
  for(const id of ['status','protocol','dimensions']) $(id).textContent='—';
  $('filename').textContent='';
  for (const id of ['original', 'enhanced', 'sample-actual', 'sample-reference', 'region-map']) { $(id).width = 1; $(id).height = 1; }
  $('file').value = '';
  $('content').classList.add('hidden');
  $('locator').classList.add('hidden');
  $('error').classList.add('hidden');
  $('drop').classList.remove('hidden');
}

async function analyze(file) {
  if (!file || busy) return;
  clearImage();
  lastInputFile=file;
  if (file.size > 25 * 1024 * 1024) { showError('图片超过25 MB，请先缩小'); return; }
  void checkVersion(true);
  const turn = ++generation;
  $('error').classList.add('hidden');
  $('content').classList.add('hidden');
  $('locator').classList.add('hidden');
  $('drop').classList.remove('hidden');
  result = null;
  setBusy(true);
  $('busytext').textContent = '浏览器正在校验水印… 最多约60秒，可随时取消';
  let loaded = null;
  try {
    loaded = await readLocalImage(file);
    if (turn !== generation) { URL.revokeObjectURL(loaded.url); return; }
    const canvas = document.createElement('canvas');
    canvas.width = loaded.image.naturalWidth; canvas.height = loaded.image.naturalHeight;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    context.drawImage(loaded.image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const decoded = await decodeInWorker(imageData.data, canvas.width, canvas.height, turn);
    canvas.width = canvas.height = 1;
    if (turn !== generation) { URL.revokeObjectURL(loaded.url); return; }
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [loaded.url]; original = loaded.image; reference = overlay = null;
    result = decoded;
    preparePixels();
    if (result.detected) ({reference, overlay} = buildBrowserReference(result, pixels.data));
    renderResult(file);
  } catch (error) {
    if (loaded) URL.revokeObjectURL(loaded.url);
    if (turn === generation && error.message !== 'cancelled') showError(error.message);
  } finally { if (turn === generation) setBusy(false); }
}

function renderResult(file) {
  $('drop').classList.add('hidden'); $('content').classList.remove('hidden');
  $('filename').textContent = file.name;
  const unresolved=result.protocol==='GHCV8'&&result.status!=='decoded';
  $('status').textContent = result.detected ? (unresolved?'水印已校验 · 无法解释字段':'已校验 · 完整载荷') : '未识别';
  $('status').className = 'value ' + (result.detected ? 'good' : 'bad');
  $('protocol').textContent = result.protocol || '—';
  const failureReasons = {
    decode_timeout: '在本次时间预算内未恢复完整载荷。可以尝试原始截图或保留更多清晰画面。',
    conflicting_payloads: '检测到相互冲突的载荷，未选择账号。对比拼图请分别截取各自区域后重试。',
    insufficient_observations: '有效观测不足，未返回任何残缺字段。请尝试保留更大的原始画面。',
    invalid_image: '图片尺寸或像素数据无效。'
  };
  $('decode-reason').classList.toggle('hidden', result.detected && !unresolved);
  $('decode-reason').textContent = unresolved ? `规则指纹 ${result.schemaFingerprint}：${result.status==='unknown_schema'?'请载入该项目匹配版本的规则文件；不能使用不匹配的规则解释字段':'业务数据未通过规则范围或补零检查，未输出字段'}` : result.detected ? '' : (failureReasons[result.reason] || '未恢复完整且唯一的兼容载荷。图片可能没有水印，或信号受到缩放、遮挡和压缩影响。');
  $('dimensions').textContent = `${(result.elapsedMs / 1000).toFixed(2)} s / ${result.width} × ${result.height}`;
  result.fields = WatermarkFields.fromResult(result);
  result.toolBuild = BUILD_INFO.buildId;
  renderPayload(result.fields);
  setupRegions();
  $('details').textContent = JSON.stringify(result, null, 2);
  for (const option of $('mode').options) option.disabled = !result.detected && ['reference', 'overlay'].includes(option.value);
  if (!result.detected && ['reference', 'overlay'].includes($('mode').value)) $('mode').value = 'residual';
  draw();
}

function renderPayload(fields) {
  const readable=result?.detected && (result.protocol!=='GHCV8'||result.status==='decoded');
  $('payload-json').textContent = readable ? JSON.stringify(WatermarkFields.toPayload(fields),null,2) : '';
  $('copy-payload').disabled = !readable;
  $('copy-payload').textContent = '复制 JSON';
  $('payload-section').classList.toggle('hidden', !readable);
}
$('copy-payload').onclick = async () => {
  if(!result?.detected)return;
  const turn=generation;
  try {
    await navigator.clipboard.writeText($('payload-json').textContent);
    if(turn===generation)$('copy-payload').textContent='已复制';
  } catch { if(turn===generation)showError('未能复制 JSON，可选中文本手动复制'); }
};

function buildBrowserReference(decoded, sourcePixels) {
  const d = decoded.diagnostics, tile = WatermarkCodec.makeTile(WatermarkCodec.fromHex(d.payloadHex));
  const plane = new Float32Array(544 * 512); let mean = 0;
  for (let i = 0; i < plane.length; i++) { plane[i] = tile[i * 4 + 2] - (tile[i * 4] + tile[i * 4 + 1]) / 2; mean += plane[i]; }
  mean /= plane.length;
  const reference = document.createElement('canvas'), overlay = document.createElement('canvas');
  reference.width = overlay.width = decoded.width; reference.height = overlay.height = decoded.height;
  const rc = reference.getContext('2d'), oc = overlay.getContext('2d');
  const ref = rc.createImageData(decoded.width, decoded.height), over = oc.createImageData(decoded.width, decoded.height);
  const xs = Int32Array.from({length: decoded.width}, (_, x) => ((Math.floor((x - d.cellPhaseX) / d.scale + d.tileShiftCellsX * 32) % 544) + 544) % 544);
  for (let y = 0; y < decoded.height; y++) {
    const yy = ((Math.floor((y - d.cellPhaseY) / d.scale + d.tileShiftCellsY * 8) % 512) + 512) % 512;
    for (let x = 0; x < decoded.width; x++) {
      const value = plane[yy * 544 + xs[x]] - mean, magnitude = Math.min(Math.abs(value) / 2.5, 1), p = (y * decoded.width + x) * 4;
      const color = value > 0 ? [20, 126, 172] : [210, 109, 35], opacity = magnitude * .6;
      for (let c = 0; c < 3; c++) { ref.data[p + c] = Math.floor(245 + (color[c] - 245) * magnitude); over.data[p + c] = Math.floor(sourcePixels[p + c] * (1 - opacity) + color[c] * opacity); }
      ref.data[p + 3] = over.data[p + 3] = 255;
    }
  }
  rc.putImageData(ref, 0, 0); oc.putImageData(over, 0, 0);
  return {reference, overlay};
}

// 使用原始规则展示，避免把编译器补全的默认值误当成用户文件内容。
function renderLoadedRules(compiled, sources) {
  const list=$('loaded-rules-list');
  list.replaceChildren();
  for(const entry of compiled) {
    const source=sources.find(item=>item.fingerprint===entry.fingerprint);
    const panel=document.createElement('details');panel.className='loaded-rule';
    const title=document.createElement('summary');
    title.textContent=`${entry.rule.projectKey} · v${entry.rule.schemaVersion} · ${entry.usedBits} / 119 位`;
    const meta=document.createElement('p');meta.className='hint';
    meta.textContent=`来源：${sources.filter(item=>item.fingerprint===entry.fingerprint).map(item=>item.name).join('、')} · 指纹：${entry.fingerprint}`;
    const fields=document.createElement('p');
    fields.textContent='字段顺序：'+entry.rule.fields.map(field=>`${field.key} (${field.type})`).join(' → ');
    const json=document.createElement('pre');json.tabIndex=0;json.setAttribute('aria-label',`${entry.rule.projectKey} 实际载入的规则 JSON`);
    json.textContent=JSON.stringify(source.rule,null,2);
    panel.append(title,meta,fields,json);list.append(panel);
  }
  $('rules-state').textContent=`已载入 ${compiled.length} 份项目规则`;
  $('loaded-rules-count').textContent=`（${compiled.length}）`;
  $('loaded-rules-panel').classList.remove('hidden');
}

$('load-rules').onclick=()=>{if(!busy)$('rules-file').click()};
$('rules-file').onchange=async event=>{
  const files=Array.from(event.target.files);if(!files.length||busy)return;
  const turn=++generation;setBusy(true);$('busytext').textContent='正在校验项目规则…';
  try {
    if(files.length>64||files.reduce((s,f)=>s+f.size,0)>800000)throw Error('规则数量或总大小超限');
    const rules=[];for(const file of files){if(file.size>128000)throw Error('单份规则超过128KB');rules.push(JSON.parse(await file.text()))}
    if(turn!==generation)return;
    const compiled=WatermarkSchema.registry(rules);
    const sources=rules.map((rule,index)=>({rule,name:files[index].name,fingerprint:WatermarkSchema.compile(rule).fingerprint}));
    renderLoadedRules(compiled,sources);projectRules=rules;
    const file=lastInputFile;setBusy(false);if(file)await analyze(file);
  } catch(error){if(turn===generation)showError('规则载入失败：'+error.message)}
  finally {if(turn===generation)setBusy(false);$('rules-file').value=''}
};
