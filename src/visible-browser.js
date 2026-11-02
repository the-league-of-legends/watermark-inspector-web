let ocrWorker=null,ocrAbort=null,visibleROI=null;
function resetVisible(){
 if(ocrAbort)ocrAbort(Error('cancelled'));ocrAbort=null;
 if(ocrWorker){void ocrWorker.terminate();ocrWorker=null;}
 visibleROI=null;roiAnchor=null;$('visible-select').setAttribute('aria-pressed','false');
 $('visible-section').classList.add('hidden');$('visible-results').replaceChildren();$('visible-status').textContent='';
 if(result){delete result.visibleIdentity;$('details').textContent=JSON.stringify(result,null,2);}
}
function ocrAssets(){return new URL('./ocr-assets/'+BUILD_INFO.ocrAssetId+'/',location.href)}
function createOCRSupervisor(){
 const url=URL.createObjectURL(new Blob([OCR_SUPERVISOR_SOURCE],{type:'application/javascript'})),native=new Worker(url);URL.revokeObjectURL(url);
 let id=0;const pending=new Map();
 native.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error('OCR资源或引擎错误：'+data.error)):p.resolve(data)};
 native.onerror=()=>{for(const p of pending.values())p.reject(Error('OCR Worker资源/CSP不可用，请使用完整静态目录'));pending.clear()};
 function send(data,transfer=[]){return new Promise((resolve,reject)=>{data.id=++id;pending.set(id,{resolve,reject});native.postMessage(data,transfer)})}
 return {init:()=>send({action:'init',base:ocrAssets().href}),recognize:async canvas=>{const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('OCR图像转换失败'))));const buffer=await blob.arrayBuffer();return send({action:'recognize',buffer},[buffer]);},terminate:()=>{native.terminate();for(const p of pending.values())p.reject(Error('cancelled'));pending.clear();}};
}
function visibleCanvas(image,rect){
 const [l,t,r,b]=rect,w=r-l,h=b-t;
 const c=document.createElement('canvas');c.width=h;c.height=w;
 const x=c.getContext('2d',{willReadFrequently:true});x.translate(0,w);x.rotate(-Math.PI/2);x.drawImage(image,l,t,w,h,0,0,w,h);return c;
}
function scaledVisible(c,contrast=false){
 const s=Math.min(3,Math.sqrt(VisibleText.MAX_PIXELS/(c.width*c.height))),out=document.createElement('canvas');out.width=Math.max(1,Math.floor(c.width*s));out.height=Math.max(1,Math.floor(c.height*s));
 const x=out.getContext('2d',{willReadFrequently:true});x.drawImage(c,0,0,out.width,out.height);
 if(contrast){const d=x.getImageData(0,0,out.width,out.height);let hist=new Uint32Array(256);for(let i=0;i<d.data.length;i+=4)hist[Math.round((d.data[i]+d.data[i+1]+d.data[i+2])/3)]++;
 let lo=0,hi=255,n=out.width*out.height*.01,sum=0;while(lo<254&&(sum+=hist[lo])<n)lo++;sum=0;while(hi>lo&&(sum+=hist[hi])<n)hi--;
 for(let i=0;i<d.data.length;i+=4){let v=Math.round((d.data[i]+d.data[i+1]+d.data[i+2])/3);v=Math.max(0,Math.min(255,(v-lo)*255/Math.max(1,hi-lo)));d.data[i]=d.data[i+1]=d.data[i+2]=v;}x.putImageData(d,0,0);
 }return {canvas:out,scale:out.width/c.width};
}
function renderVisible(value){
 if(!result)return;result.visibleIdentity=value;$('details').textContent=JSON.stringify(result,null,2);
 const names={needs_retry:'范围已调整 · 请重新读取',candidate:value.confidence==='dual_agree'?'双侧 OCR 一致':'单侧 OCR 候选',conflict:'两侧读数冲突 · 未选择账号',unlogged:'未登录标记0 · 不用于查询',uncertain:'不确定 · 未选择账号',error:'OCR不可用',cancelled:'已取消'};
 $('visible-status').textContent=(names[value.status]||value.status)+' · 未经水印校验';
 if(value.error){const p=document.createElement('p');p.textContent=value.error;$('visible-results').append(p);}
 if(value.account){const p=document.createElement('p');p.className='value mono';p.textContent=value.account;$('visible-results').prepend(p);}
 for(const o of value.observations||[]){const p=document.createElement('p');p.textContent=`${o.side==='left'?'左侧':'右侧'}：${o.clear?o.text:'不确定'} · OCR ${o.confidence.toFixed(1)} · ${o.reason}`;$('visible-results').append(p);}
}
async function runVisible(turn=generation){
 if(!original||!result||result.detected||result.reason==='conflicting_payloads')return;
 resetVisible();$('visible-section').classList.remove('hidden');$('visible-status').textContent='准备侧边明文…';
 const started=performance.now(),image=original,baseResult=result;
 let timer,worker,ended=false;
 const work=async()=>{
  if(!['http:','https:'].includes(location.protocol))throw Error('单独打开HTML时OCR资源不可用；隐形解码仍可使用。请通过HTTP(S)打开完整静态目录。');
  const profile=BUNDLED_ANALYSIS.visibleIdentity;
  if(profile?.enabled!==true||profile.profile!=='visible-edge-text-v1'||new Set(projectRules.map(rule=>rule.projectKey)).size!==1||!projectRules.some(rule=>rule.projectKey===BUNDLED_ANALYSIS.projectKey))throw Error('当前项目未声明侧边明文布局，不能把普通UI数字解释为账号');
  const auto=VisibleText.bounds(pixels.data,pixels.width,pixels.height);
  visibleROI=$('visible-custom').checked?[$('roi-l'),$('roi-t'),$('roi-r'),$('roi-b')].map(e=>Number(e.value)):auto;
  const [l,t,r,b]=visibleROI;
  if(!visibleROI.every(Number.isFinite)||l<0||t<0||r>image.width||b>image.height||r-l<4||b-t<4)throw Error('手机画面范围无效，请填写原图像素坐标');
  if(!$('visible-custom').checked)[$('roi-l'),$('roi-t'),$('roi-r'),$('roi-b')].forEach((e,i)=>e.value=visibleROI[i]);
  const strip=Math.ceil((r-l)*profile.sideWidthRatio),previews=[];
  for(const [side,rect]of [['left',[l,t,l+strip,b]],['right',[r-strip,t,r,b]]]){
   const upright=visibleCanvas(image,rect),enlarged=scaledVisible(upright),contrast=scaledVisible(upright,true);
   const article=document.createElement('article'),label=document.createElement('p');label.textContent=`${side==='left'?'左':'右'}侧 · 转正预览（保留完整高度）`;
   article.append(label,upright);const details=document.createElement('details'),sum=document.createElement('summary');sum.textContent='查看放大与对比度版本';details.append(sum);
   upright.className='visible-preview';for(const c of [enlarged.canvas,contrast.canvas]){c.className='visible-preview';details.append(c)}article.append(details);$('visible-results').append(article);
   previews.push({side,rect,upright,enlarged,contrast});
  }
  if(ended||turn!==generation)throw Error('cancelled');
  $('visible-status').textContent='OCR识别中（含初始化最多30秒）…';
  worker=createOCRSupervisor();ocrWorker=worker;await worker.init();if(ended||turn!==generation)throw Error('cancelled');
  const observations=[];let sideConflict=false;
  for(const p of previews){
   const attempts=[];
   for(const variant of [p.enlarged,p.contrast]){
    if(ended||turn!==generation)throw Error('cancelled');
    const {data}=await worker.recognize(variant.canvas);
    attempts.push(...VisibleText.observation(data,p.side,p.upright.width,p.upright.height,variant.scale));
   }
   const good=attempts.filter(o=>o.clear);const unique=[...new Set(good.map(o=>o.text))];
   // 同侧不同预处理有不同清晰读数时也拒答，不挑自己喜欢的账号。
   if(unique.length>1){sideConflict=true;observations.push(...good.map(o=>({...o,clear:false,reason:'同侧OCR预处理读数冲突'})));}
   else {const best=(good.length?good:attempts).sort((a,b)=>b.confidence-a.confidence)[0];if(best)observations.push({...best,sourceBox:p.rect});}
  }
  return {...(sideConflict?{status:'conflict',confidence:null}:VisibleText.classify(observations,profile.maxValue)),observations};
 };
 try{
  const timeout=new Promise((_,reject)=>{ocrAbort=reject;timer=setTimeout(()=>reject(Error('OCR超过30秒（包含初始化），未选择账号')),30000)});
  const value=await Promise.race([work(),timeout]);
  if(turn!==generation||result!==baseResult)return;
  renderVisible({...value,reader:'browser_ocr',method:'visible_edge_text',projectKey:BUNDLED_ANALYSIS.projectKey,identityField:BUNDLED_ANALYSIS.identityField,referenceRange:visibleROI,elapsedMs:Math.round(performance.now()-started),validation:{bch:'not_applicable',crc:'not_applicable',authenticated:false}});
 }catch(e){if(turn===generation&&result===baseResult&&e.message!=='cancelled')renderVisible({status:'error',reader:'browser_ocr',error:e.message,elapsedMs:Math.round(performance.now()-started)});}
 finally{ended=true;clearTimeout(timer);ocrAbort=null;if(worker)void worker.terminate();if(ocrWorker===worker)ocrWorker=null;if(turn===generation)setBusy(false);}
}
$('visible-retry').onclick=()=>{if(!busy){setBusy(true);void runVisible()}};

let roiAnchor=null;
$('visible-select').onclick=()=>{if(!original||busy)return;$('visible-custom').checked=true;$('visible-select').setAttribute('aria-pressed','true');$('visible-status').textContent='在下方原图拖动框选手机画面，再点重新读取侧边';$('region-map').scrollIntoView({block:'center'});};
function roiPoint(e){const c=$('region-map'),b=c.getBoundingClientRect();return [Math.max(0,Math.min(c.width,Math.round((e.clientX-b.left)*c.width/b.width))),Math.max(0,Math.min(c.height,Math.round((e.clientY-b.top)*c.height/b.height)))];}
$('region-map').addEventListener('pointerdown',e=>{if($('visible-select').getAttribute('aria-pressed')!=='true'||busy)return;e.preventDefault();roiAnchor=roiPoint(e);$('region-map').setPointerCapture(e.pointerId)});
$('region-map').addEventListener('pointerup',e=>{if(!roiAnchor)return;const q=roiPoint(e),box=[Math.min(q[0],roiAnchor[0]),Math.min(q[1],roiAnchor[1]),Math.max(q[0],roiAnchor[0]),Math.max(q[1],roiAnchor[1])];roiAnchor=null;['l','t','r','b'].forEach((k,i)=>$('roi-'+k).value=box[i]);invalidateVisibleRange();$('visible-select').setAttribute('aria-pressed','false');const c=$('region-map'),x=c.getContext('2d');x.drawImage(original,0,0);x.strokeStyle='#7c3aed';x.lineWidth=Math.max(2,c.width/250);x.strokeRect(box[0],box[1],box[2]-box[0],box[3]-box[1]);$('visible-section').scrollIntoView({block:'start'});});

$('region-map').addEventListener('pointercancel',()=>{roiAnchor=null});

// 修改读取范围即撤下旧候选，不让旧区域的身份看似属于新区域。
function invalidateVisibleRange(){
 if(busy||!result||!original)return;
 resetVisible();$('visible-section').classList.remove('hidden');
 renderVisible({status:'needs_retry',reader:'browser_ocr',method:'visible_edge_text'});
}
for(const id of ['roi-l','roi-t','roi-r','roi-b','visible-custom'])$(id).addEventListener('change',invalidateVisibleRange);
