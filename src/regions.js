
// 粘贴与框选只作用于检查器，不改变手机上的纹理强度。
let selectedTile = null;
const baseDraw = draw;
const baseSetBusy = setBusy;

setBusy = function(value) {
  baseSetBusy(value);
  for (const id of ['paste', 'paste-empty','load-rules']) $(id).disabled = value;
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

let regionLayout = {status:'unavailable',regions:[]};
let selectedRegionId = null;
function resetRegions() {
  selectedTile=null; selectedRegionId=null;
  regionLayout={status:'unavailable',regions:[]};
  $('region-list').replaceChildren(); $('region-list-count').textContent='';
  $('region-summary').textContent='无法确认水印数量和位置';
  $('region-selection').textContent='点击编号框或列表查看对应位置';
  $('boxes').disabled=true; $('technical').open=false;
}
function codingTiles() {
  return regionLayout.regions.filter(r=>r.kind==='complete').map(r=>({...r.tileRect,scale:r.scale}));
}
function setupRegions() {
  const bounds=result.detected ? WatermarkCodec.evidenceBounds(pixels.data,original.width,original.height) : null;
  regionLayout=WatermarkRegions.estimate(result,original.width,original.height,bounds);
  result.regionLayout=regionLayout;
  selectedRegionId=null; selectedTile=result.diagnostics?.transportProfile==='edge-v1-preview'?null:codingTiles()[0] || null;
  $('region-list').replaceChildren();
  const available=regionLayout.status==='estimated';
  $('boxes').disabled=!available;
  $('region-summary').textContent=available
    ? `${result.protocol==='GHCV8'&&result.status!=='decoded'?'已校验水印，尚未解释业务字段。':'已恢复完整信息。'}${result.diagnostics?.transportProfile==='edge-v1-preview'?'左右条带合并解码。':''}参考范围内推算有 ${regionLayout.completeCount} 个完整尺寸区域、${regionLayout.partialCount} 个边缘残片。`
    : '无法确认水印数量和位置';
  $('region-list-count').textContent=available ? `· ${regionLayout.regions.length} 处` : '· 无法确认';
  $('region-list-panel').open=window.matchMedia('(min-width: 851px)').matches;
  for(const region of regionLayout.regions) {
    const button=document.createElement('button');button.type='button';button.dataset.region=region.id;
    button.textContent=`${region.id} · ${region.kind==='complete'?'完整尺寸区域':'边缘残片'}`;
    button.setAttribute('aria-pressed','false');button.onclick=()=>selectRegion(region.id);
    $('region-list').append(button);
  }
  $('locator').classList.toggle('hidden',!selectedTile);
}
function selectRegion(id) {
  const region=regionLayout.regions.find(r=>r.id===id);if(!region)return;
  selectedRegionId=id;
  $('boxes').checked=true;
  const {x,y,width,height}=region.visibleRect;
  $('region-selection').textContent=`第 ${id} 区 · ${region.kind==='complete'?'完整尺寸区域':'边缘残片'} · 原图位置 (${Math.round(x)}, ${Math.round(y)})，${Math.round(width)} × ${Math.round(height)} 像素`;
  for(const button of $('region-list').children)button.setAttribute('aria-pressed',String(Number(button.dataset.region)===id));
  selectedTile=result.diagnostics?.transportProfile!=='edge-v1-preview' && region.kind==='complete' ? {...region.tileRect,scale:region.scale} : null;
  draw();
  // 原始像素放大后，将所选区域移到图片视口内，不滚动整张页面。
  if($('zoom').value!=='fit') {
    const view=$('map-view'),canvas=$('region-map'),v=view.getBoundingClientRect(),c=canvas.getBoundingClientRect();
    const scale=c.width/original.width;
    view.scrollLeft+=c.left-v.left+(x+width/2)*scale-view.clientWidth/2;
    view.scrollTop+=c.top-v.top+(y+height/2)*scale-view.clientHeight/2;
  }
  const list=$('region-list'),button=list.querySelector(`[data-region="${id}"]`);
  if(button && list.clientHeight) {
    const a=list.getBoundingClientRect(),b=button.getBoundingClientRect();
    if(b.top<a.top)list.scrollTop+=b.top-a.top;
    else if(b.bottom>a.bottom)list.scrollTop+=b.bottom-a.bottom;
  }
}
function drawRegionMap() {
  const canvas=$('region-map'),ctx=canvas.getContext('2d');canvas.width=original.width;canvas.height=original.height;
  ctx.drawImage(original,0,0);resize();
  if(regionLayout.status!=='estimated' || !$('boxes').checked)return;
  const scale=Math.max(.01,canvas.getBoundingClientRect().width/canvas.width),stroke=1.5/scale;
  ctx.save();
  const bounds=regionLayout.referenceBounds;
  ctx.strokeStyle='#8264ab';ctx.lineWidth=stroke;
  ctx.strokeRect(bounds.x,bounds.y,bounds.width,bounds.height);
  for(const region of regionLayout.regions) {
    const r=region.visibleRect,active=region.id===selectedRegionId;
    ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();
    const color=active?'#182c3d':region.kind==='complete'?'#147eac':'#a56527';
    ctx.strokeStyle=color;ctx.lineWidth=(active?3:1.5)/scale;
    ctx.setLineDash(region.kind==='partial'?[6/scale,4/scale]:[]);
    ctx.strokeRect(r.x+stroke/2,r.y+stroke/2,Math.max(0,r.width-stroke),Math.max(0,r.height-stroke));
    if(active){ctx.fillStyle='rgba(20,126,172,.15)';ctx.fillRect(r.x,r.y,r.width,r.height)}
    ctx.setLineDash([]);
    if(r.width*scale>=20 && r.height*scale>=18){
      ctx.font=`600 ${12/scale}px -apple-system,sans-serif`;ctx.textBaseline='top';
      const label=String(region.id),labelWidth=(ctx.measureText(label).width+10/scale);
      ctx.fillStyle=color;ctx.fillRect(r.x,r.y,labelWidth,20/scale);ctx.fillStyle='white';ctx.fillText(label,r.x+5/scale,r.y+2/scale);
    }
    ctx.restore();
  }
  ctx.restore();
}
draw = function() {
  if(!original || !result)return;
  drawRegionMap();
  $('locator').classList.toggle('hidden',!selectedTile);
  if(!$('technical').open)return;
  baseDraw();
  const ctx=$('original').getContext('2d');ctx.clearRect(0,0,original.width,original.height);ctx.drawImage(original,0,0);
  if(!selectedTile || !reference)return;
  drawSample($('enhanced').getContext('2d'));
  if($('boxes').checked) for(const canvas of [$('original'),$('enhanced')]) {
    const c=canvas.getContext('2d'),s=Math.max(.01,canvas.getBoundingClientRect().width/canvas.width);
    c.strokeStyle='#147eac';c.lineWidth=1.5/s;
    for(const tile of codingTiles()) {
      c.strokeRect(tile.x,tile.y,tile.width,tile.height);
      c.fillStyle='rgba(210,109,35,.2)';c.fillRect(tile.x+512*tile.scale,tile.y,32*tile.scale,tile.height);
    }
    c.strokeStyle='#182c3d';c.lineWidth=3/s;c.strokeRect(selectedTile.x,selectedTile.y,selectedTile.width,selectedTile.height);
  }
};
$('region-map').onclick = event => {
  if(!$('boxes').checked || !original)return;
  const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)*original.width/rect.width,y=(event.clientY-rect.top)*original.height/rect.height;
  const hit=regionLayout.regions.find(r=>{const v=r.visibleRect;return x>=v.x&&x<v.x+v.width&&y>=v.y&&y<v.y+v.height});
  if(hit)selectRegion(hit.id);
};
$('technical').ontoggle=()=>{if($('technical').open)draw()};

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
