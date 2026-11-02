let ocrWorker=null,ocrAbort=null,visibleROI=null;
function resetVisible(){
 if(ocrAbort)ocrAbort(Error('cancelled'));ocrAbort=null;
 if(ocrWorker){void ocrWorker.terminate();ocrWorker=null;}
 visibleROI=null;roiAnchor=null;$('visible-select').setAttribute('aria-pressed','false');
 $('visible-section').classList.add('hidden');$('visible-results').replaceChildren();$('visible-status').textContent='';$('visible-range').textContent='';$('visible-map').width=$('visible-map').height=1;$('download').textContent='导出位置标注图';
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
function directionCanvas(image,rect,rotation,contrast=false,maxScale=2){
 const [l,t,r,b]=rect,w=r-l,h=b-t,scale=Math.min(maxScale,Math.sqrt(VisibleText.MAX_PIXELS/(w*h)));
 const out=document.createElement('canvas');out.width=Math.max(1,Math.floor(h*scale));out.height=Math.max(1,Math.floor(w*scale));
 const x=out.getContext('2d',{willReadFrequently:true});x.fillStyle='white';x.fillRect(0,0,out.width,out.height);x.scale(out.width/h,out.height/w);
 if(rotation===-90){x.translate(0,w);x.rotate(-Math.PI/2)}else{x.translate(h,0);x.rotate(Math.PI/2)}
 x.drawImage(image,l,t,w,h,0,0,w,h);
 if(contrast){const d=x.getImageData(0,0,out.width,out.height);let hist=new Uint32Array(256);for(let i=0;i<d.data.length;i+=4)hist[Math.round((d.data[i]+d.data[i+1]+d.data[i+2])/3)]++;
 let lo=0,hi=255,n=out.width*out.height*.01,sum=0;while(lo<254&&(sum+=hist[lo])<n)lo++;sum=0;while(hi>lo&&(sum+=hist[hi])<n)hi--;
 for(let i=0;i<d.data.length;i+=4){let v=Math.round((d.data[i]+d.data[i+1]+d.data[i+2])/3);v=Math.max(0,Math.min(255,(v-lo)*255/Math.max(1,hi-lo)));d.data[i]=d.data[i+1]=d.data[i+2]=v;}x.putImageData(d,0,0);}
 return {canvas:out,scaleX:out.width/h,scaleY:out.height/w};
}
function directionLabel(o){return `区域 ${Number(o.regionId?.replace('region-',''))||'?'} · ${o.rotationDegrees===-90?'向下竖向文字':'向上竖向文字'}`}
function renderDirectionRegions(observations){
 const groups=new Map();for(const o of observations){const old=groups.get(o.regionId);if(!old||o.confidence>old.confidence)groups.set(o.regionId,o)}
 const map=$('visible-map');map.width=original.width;map.height=original.height;const x=map.getContext('2d');x.drawImage(original,0,0,map.width,map.height);
 for(const o of [...groups.values()].slice(0,12)){
  const [l,t,r,b]=o.sourceBox;x.strokeStyle=o.clear?'#b45309':'#64748b';x.lineWidth=Math.max(2,map.width/500);x.strokeRect(l,t,r-l,b-t);
  x.font=`${Math.max(12,map.width/80)}px sans-serif`;x.fillStyle=x.strokeStyle;x.fillText(o.regionId,Math.max(0,l),Math.max(14,t-4));
  const article=document.createElement('article'),label=document.createElement('p');label.textContent=`${directionLabel(o)} · 原图 (${Math.round(l)}, ${Math.round(t)})～(${Math.round(r)}, ${Math.round(b)})`;
  const pad=Math.max(8,r-l),rect=[Math.max(visibleROI[0],l-pad),visibleROI[1],Math.min(visibleROI[2],r+pad),visibleROI[3]];
  const preview=directionCanvas(original,rect,o.rotationDegrees,false,1).canvas;preview.className='visible-preview';article.append(label,preview);$('visible-results').append(article);
 }
}
function renderVisible(value){
 if(!result)return;result.visibleIdentity=value;$('details').textContent=JSON.stringify(result,null,2);
 const names={needs_retry:'范围已调整 · 请重新读取',candidate:value.confidence==='multiple_agree'?`多处 OCR 一致（${value.regionCount}处）`:value.confidence==='dual_agree'?'双侧 OCR 一致':'单处 OCR 候选',conflict:'OCR读数冲突 · 未选择账号',unlogged:'未登录标记0 · 不用于查询',uncertain:'不确定 · 未选择账号',error:'OCR不可用',incomplete:'候选较多 · 请框选异常区域重试',cancelled:'已取消'};
 $('visible-status').textContent=(names[value.status]||value.status)+' · 未经水印校验';
 if(value.error){const p=document.createElement('p');p.textContent=value.error;$('visible-results').append(p);}
 $('download').textContent=value.observations?.length?'导出文字候选位置':'导出位置标注图';
 if(value.account){const p=document.createElement('p');p.className='value mono';p.textContent=value.account;$('visible-results').prepend(p);}
 const groups=new Map();for(const o of value.observations||[]){const group=groups.get(o.regionId)||[];group.push(o);groups.set(o.regionId,group)}
 for(const group of groups.values()){
  const values=[...new Set(group.filter(o=>o.clear).map(o=>o.text))],o=group.slice().sort((a,b)=>b.confidence-a.confidence)[0];
  const p=document.createElement('p');p.textContent=`${directionLabel(o)}：${values.length>1?'读数冲突':values.length===1?values[0]:'不确定'} · OCR ${o.confidence.toFixed(1)} · ${values.length>1?'同一位置的不同扫描读数不一致':o.reason}`;$('visible-results').append(p);
 }

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
  const auto=[0,0,image.width,image.height];
  visibleROI=$('visible-custom').checked?[$('roi-l'),$('roi-t'),$('roi-r'),$('roi-b')].map(e=>Number(e.value)):auto;
  const [l,t,r,b]=visibleROI;
  if(!visibleROI.every(Number.isFinite)||l<0||t<0||r>image.width||b>image.height||r-l<4||b-t<4)throw Error('搜索范围无效，请填写原图像素坐标');
  if(!$('visible-custom').checked)[$('roi-l'),$('roi-t'),$('roi-r'),$('roi-b')].forEach((e,i)=>e.value=visibleROI[i]);
  $('visible-range').textContent=($('visible-custom').checked?'指定':'全图')+`读取范围：(${l}, ${t})～(${r}, ${b})，${r-l} × ${b-t} 像素；按两种竖向文字方向查找，不要求账号位于整图边缘。`;
  if(ended||turn!==generation)throw Error('cancelled');
  $('visible-status').textContent='按竖向文字方向搜索（含初始化最多30秒）…';
  $('busytext').textContent='浏览器正在按文字方向读取明文… 最多30秒，未经水印校验';
  worker=createOCRSupervisor();ocrWorker=worker;await worker.init();if(ended||turn!==generation)throw Error('cancelled');
  const observations=[],seeds=[],searched=[];let truncated=false;
  async function scan(rect,rotation,contrast,maxScale,stage){
   if(ended||turn!==generation)throw Error('cancelled');
   const input=directionCanvas(image,rect,rotation,contrast,maxScale);
   try{
    const {data}=await worker.recognize(input.canvas);
    const values=VisibleText.observation(data,'direction',rect[3]-rect[1],rect[2]-rect[0],input.scaleX);
    // 横纵取整比例略有不同，字框先还原为旋转前的原始像素。
    for(const o of values){o.box.y0*=input.scaleX/input.scaleY;o.box.y1*=input.scaleX/input.scaleY;}
    const numeric=values.filter(o=>o.directionAligned&&/^(0|[1-9][0-9]{1,19})$/.test(o.text));
    if(numeric.length>64)truncated=true;
    for(const o of numeric.slice(0,64)){
     o.sourceBox=VisibleText.sourceBox(o.box,rect,rotation);o.rotationDegrees=rotation;o.searchStage=stage;
     observations.push(o);if(stage==='global'&&o.complete)seeds.push(o);
    }
    searched.push({stage,rect,rotationDegrees:rotation,contrast});
   }finally{input.canvas.width=input.canvas.height=1;}
  }
  // 全范围两个方向都扫描，不能因某个边缘先读到账号就跳过其他区域的冲突。
  for(const rotation of [-90,90])for(const contrast of [false,true])await scan(visibleROI,rotation,contrast,2,'global');
  const local=[];
  for(const o of seeds.sort((a,b)=>b.confidence-a.confidence)){
   if(local.some(p=>p.rotationDegrees===o.rotationDegrees&&Math.min(p.sourceBox[2],o.sourceBox[2])-Math.max(p.sourceBox[0],o.sourceBox[0])>0))continue;
   local.push(o);if(local.length===8)break;
  }
  for(const o of local){
   const pad=Math.max(10,o.sourceBox[2]-o.sourceBox[0]);
   const rect=[Math.max(l,Math.floor(o.sourceBox[0]-pad)),t,Math.min(r,Math.ceil(o.sourceBox[2]+pad)),b];
   // 只沿文字横向收窄，保留范围的完整高度，不用粗读出的字符当提示或拼补片段。
   for(const contrast of [false,true])await scan(rect,o.rotationDegrees,contrast,3,'refine');
  }
  const located=VisibleText.locate(observations);
  renderDirectionRegions(located);
  return {...(truncated?{status:'incomplete'}:VisibleText.classify(located,profile.maxValue)),observations:located,
    search:{strategy:'vertical_text_directions',positionsRequired:false,rotationDegrees:[-90,90],passes:searched}};

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
$('visible-select').onclick=()=>{if(!original||busy)return;$('visible-custom').checked=true;$('visible-select').setAttribute('aria-pressed','true');$('visible-status').textContent='在下方原图拖动框选搜索区域，再点重新读取侧边';$('region-map').scrollIntoView({block:'center'});};
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
