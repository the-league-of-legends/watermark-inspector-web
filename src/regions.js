
// 粘贴与框选只作用于检查器，不改变手机上的纹理强度。
let selectedTile = null;
const baseAnalyze = analyze;
const baseDraw = draw;
const baseSetBusy = setBusy;

setBusy = function(value) {
  baseSetBusy(value);
  for (const id of ['paste', 'paste-empty']) $(id).disabled = value;
};

async function pasteImage() {
  if (busy) return;
  if (!navigator.clipboard?.read) {
    showError('此浏览器不支持粘贴按钮，请在页面直接按 ⌘V / Ctrl+V，或选择图片');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(type => type.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        await analyze(new File([blob], '剪贴板截图.png', {type: blob.type}));
        return;
      }
    }
    showError('剪贴板里没有图片。请先复制截图本身，再按 ⌘V / Ctrl+V');
  } catch (error) {
    showError('未能读取剪贴板。请在页面直接按 ⌘V / Ctrl+V 粘贴图片，或选择图片');
  }
}

$('paste').onclick = pasteImage;
$('paste-empty').onclick = event => { event.stopPropagation(); pasteImage(); };
document.addEventListener('paste', event => {
  const image = Array.from(event.clipboardData?.items || [])
    .find(item => item.kind === 'file' && item.type.startsWith('image/'));
  if (!image) return;
  event.preventDefault();
  if (busy) return;
  const blob = image.getAsFile();
  analyze(new File([blob], '剪贴板截图.png', {type: blob.type}));
});

function codingTiles() {
  if (!result?.detected || !result.diagnostics) return [];
  const d = result.diagnostics, scale = d.scale;
  const width = 544 * scale, height = 512 * scale;
  const x0 = d.cellPhaseX - d.tileShiftCellsX * 32 * scale;
  const y0 = d.cellPhaseY - d.tileShiftCellsY * 8 * scale;
  const tiles = [];
  for (let row = Math.floor(-y0 / height); y0 + row * height < original.height; row++) {
    for (let col = Math.floor(-x0 / width); x0 + col * width < original.width; col++) {
      const x = x0 + col * width, y = y0 + row * height;
      if (x >= 0 && y >= 0 && x + width <= original.width && y + height <= original.height) {
        tiles.push({x, y, width, height, scale});
      }
    }
  }
  return tiles;
}

analyze = async function(file) {
  if (!file || busy) return;
  selectedTile = null;
  await baseAnalyze(file);
  if (!result || busy) return;
  const tiles = codingTiles();
  if (tiles.length) {
    selectedTile = tiles.reduce((best, tile) => {
      const distance = value => Math.abs(value.x + value.width / 2 - original.width / 2)
        + Math.abs(value.y + value.height / 2 - original.height / 2);
      return distance(tile) < distance(best) ? tile : best;
    });
  }
  $('locator').classList.toggle('hidden', !tiles.length);
  $('boxes').disabled = !tiles.length;
  draw();
};

draw = function() {
  baseDraw();
  if (!original || !result) return;
  const originalContext = $('original').getContext('2d');
  originalContext.clearRect(0, 0, original.width, original.height);
  originalContext.drawImage(original, 0, 0);
  $('original-caption').textContent = result.detected && $('boxes').checked ? '原图 + 参考编码框' : '不增强 · 保留内容';
  if (!result.detected || !selectedTile) return;
  const enhancedContext = $('enhanced').getContext('2d');
  // 在加框之前截取真实增强像素，保证样例不包含标注生成的颜色。
  const sampleArea = drawSample(enhancedContext);
  if (!$('boxes').checked) return;
  for (const canvas of [$('original'), $('enhanced')]) {
    const ctx = canvas.getContext('2d');
    const displayScale = Math.max(canvas.getBoundingClientRect().width / canvas.width, .05);
    const stroke = 1.5 / displayScale;
    for (const tile of codingTiles()) {
      ctx.strokeStyle = '#147eac';
      ctx.lineWidth = stroke;
      ctx.strokeRect(tile.x + stroke / 2, tile.y + stroke / 2,
        tile.width - 32 * tile.scale - stroke, tile.height - stroke);
      ctx.fillStyle = 'rgba(210,109,35,.13)';
      ctx.fillRect(tile.x + 512 * tile.scale, tile.y, 32 * tile.scale, tile.height);
      ctx.strokeStyle = '#d26d23';
      ctx.strokeRect(tile.x + 512 * tile.scale, tile.y, 32 * tile.scale, tile.height);
    }
    const tile = selectedTile;
    ctx.strokeStyle = '#142c3b';
    ctx.lineWidth = 3 / displayScale;
    ctx.strokeRect(tile.x, tile.y, tile.width, tile.height);
    ctx.save();
    ctx.setLineDash([5 / displayScale, 3 / displayScale]);
    ctx.strokeRect(sampleArea.x, sampleArea.y, sampleArea.width, sampleArea.height);
    ctx.restore();
    ctx.font = `600 ${12 / displayScale}px -apple-system, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#142c3b';
    ctx.fillRect(tile.x, tile.y, Math.min(tile.width, 100 / displayScale), 24 / displayScale);
    ctx.fillStyle = 'white';
    ctx.fillText('① 放大样例', tile.x + 6 / displayScale, tile.y + 4 / displayScale);
  }
};

function drawSample(enhancedContext) {
  const tile = selectedTile, scale = tile.scale;
  const cropWidth = Math.min(Math.round(256 * scale), original.width);
  const cropHeight = Math.min(Math.round(64 * scale), original.height);
  const x = Math.max(0, Math.min(original.width - cropWidth, Math.round(tile.x + 128 * scale)));
  const y = Math.max(0, Math.min(original.height - cropHeight, Math.round(tile.y + 224 * scale)));
  const mode = $('mode').value;
  // 参考模式下，左侧样例仍固定显示真实像素残差，防止把重建图误当提取图。
  let source = $('enhanced');
  if (mode === 'reference' || mode === 'overlay') {
    source = document.createElement('canvas');
    source.width = cropWidth;
    source.height = cropHeight;
    const ctx = source.getContext('2d'), output = ctx.createImageData(cropWidth, cropHeight);
    const gain = +$('gain').value;
    for (let row = 0; row < cropHeight; row++) {
      for (let col = 0; col < cropWidth; col++) {
        const value = residual[(y + row) * original.width + x + col];
        const amount = Math.min(Math.abs(value) * gain / 128, 1);
        const color = value >= 0 ? [20, 126, 172] : [210, 109, 35];
        const offset = (row * cropWidth + col) * 4;
        for (let c = 0; c < 3; c++) output.data[offset + c] = 245 + (color[c] - 245) * amount;
        output.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(output, 0, 0);
  }
  for (const [id, image] of [['sample-actual', source], ['sample-reference', reference]]) {
    const canvas = $(id), ctx = canvas.getContext('2d');
    canvas.width = 1024;
    canvas.height = 256;
    ctx.imageSmoothingEnabled = false;
    if (image === source && source !== $('enhanced')) {
      ctx.drawImage(image, 0, 0, cropWidth, cropHeight, 0, 0, 1024, 256);
    } else {
      ctx.drawImage(image, x, y, cropWidth, cropHeight, 0, 0, 1024, 256);
    }
    ctx.strokeStyle = 'rgba(20,44,59,.45)';
    ctx.lineWidth = 1;
    for (let col = 0; col <= 8; col++) { ctx.beginPath(); ctx.moveTo(col * 128, 0); ctx.lineTo(col * 128, 256); ctx.stroke(); }
    for (let row = 0; row <= 8; row++) { ctx.beginPath(); ctx.moveTo(0, row * 32); ctx.lineTo(1024, row * 32); ctx.stroke(); }
  }
  $('sample-position').textContent = `原图 (${x}, ${y}) 起的 ${cropWidth} × ${cropHeight} 像素局部`;
  return {x, y, width: cropWidth, height: cropHeight};
}

for (const id of ['original', 'enhanced']) {
  $(id).addEventListener('click', event => {
    if (!result?.detected) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) * original.width / rect.width;
    const y = (event.clientY - rect.top) * original.height / rect.height;
    const hit = codingTiles().find(tile => x >= tile.x && x < tile.x + tile.width
      && y >= tile.y && y < tile.y + tile.height);
    if (hit) { selectedTile = hit; draw(); }
  });
}
$('next-sample').onclick = () => {
  const tiles = codingTiles();
  const index = tiles.findIndex(tile => tile.x === selectedTile?.x && tile.y === selectedTile?.y);
  selectedTile = tiles[(index + 1) % tiles.length];
  draw();
};
$('boxes').onchange = draw;
$('mode').onchange = draw;
$('gain').oninput = draw;
$('zoom').onchange = () => { resize(); draw(); };
