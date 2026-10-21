// 本文件只使用用户选定的图片像素，不使用文件名、账号缓存、本机日志或网络。
let activeWorker = null, rejectActive = null;
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
    worker.postMessage({buffer: data.buffer, width, height}, [data.buffer]);
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
  selectedTile = null;
  for (const id of ['original', 'enhanced', 'sample-actual', 'sample-reference']) { $(id).width = 1; $(id).height = 1; }
  $('file').value = '';
  $('content').classList.add('hidden');
  $('locator').classList.add('hidden');
  $('error').classList.add('hidden');
  $('drop').classList.remove('hidden');
}

async function analyze(file) {
  if (!file || busy) return;
  if (file.size > 25 * 1024 * 1024) { showError('图片超过25 MB，请先缩小'); return; }
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
  $('status').textContent = result.detected ? '已校验 · 完整载荷' : '未识别';
  $('status').className = 'value ' + (result.detected ? 'good' : 'bad');
  $('uid').textContent = result.detected ? (result.userId || '未登录') : '—';
  $('game-label').textContent = result.protocol === 'GHCV7' ? '子游戏 ID' : '游戏 ID（旧版主游戏）';
  $('game').textContent = result.detected ? String(result.gameId) : '—';
  $('time').textContent = result.detected ? new Date(result.timeStartUtc * 1000).toLocaleString('zh-CN', {hour12: false}) : '—';
  $('dimensions').textContent = `${(result.elapsedMs / 1000).toFixed(2)} s / ${result.width} × ${result.height}`;
  $('details').textContent = JSON.stringify(result, null, 2);
  for (const option of $('mode').options) option.disabled = !result.detected && ['reference', 'overlay'].includes(option.value);
  if (!result.detected && ['reference', 'overlay'].includes($('mode').value)) $('mode').value = 'residual';
  draw();
}

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
