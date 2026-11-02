// 独立明文候选：从不改写已校验载荷，不推导游戏/时间。
const VisibleText = (() => {
 const MAX_PIXELS=4000000;
 function bounds(data,w,h) {
  // 从实际边界连续向内查找，不预设外框占比或手机宽高比。
  // 检查全部像素并遇到明显内容立即停止，避免抽样跳过贴边的细字。
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||data.length!==w*h*4)return [0,0,w,h];
  function darkLine(start,step,count){
   let lo=255,hi=0;
   for(let n=0,i=start;n<count;n++,i+=step){
    if(data[i+3]!==255)return false;
    for(let c=0;c<3;c++){
     lo=Math.min(lo,data[i+c]);hi=Math.max(hi,data[i+c]);
     if(hi>=70||hi-lo>=8)return false;
    }
   }
   return true;
  }
  let l=0,t=0,rr=w,b=h;
  while(t<b&&darkLine(t*w*4,4,w))t++;
  while(b>t&&darkLine((b-1)*w*4,4,w))b--;
  if(t===b)return [0,0,w,h];
  while(l<rr&&darkLine((t*w+l)*4,w*4,b-t))l++;
  while(rr>l&&darkLine((t*w+rr-1)*4,w*4,b-t))rr--;
  // 只有碎点或全暗图时不给出伪精确的画面范围，仍允许手工框选。
  if(rr-l<4||b-t<4)return [0,0,w,h];
  return [l,t,rr,b];
 }
 function classify(observations,maxValue='9223372036854775807') {
  const good=observations.filter(o=>o.clear&&o.complete&&/^(0|[1-9][0-9]*)$/.test(o.text)&&o.text.length<=20&&BigInt(o.text)<=BigInt(maxValue));
  const ids=[...new Set(good.map(o=>o.text))];
  if(ids.length>1)return {status:'conflict',confidence:null};
  if(ids[0]==='0')return {status:'unlogged',confidence:null};
  if(ids.length===1)return {status:'candidate',account:ids[0],confidence:new Set(good.map(o=>o.regionId||o.side)).size>=2?(good.some(o=>o.regionId)?'multiple_agree':'dual_agree'):'single_clear',regionCount:new Set(good.map(o=>o.regionId||o.side)).size};
  return {status:'uncertain',confidence:null};
 }
 function lines(data) {
  return (data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
 }
 function observation(data,side,width,height,scale,offset=0) {
  return lines(data).map(line=>{
   const text=(line.text||'').trim().replace(/^UID\s*[:：]\s*/i,'');const b=line.bbox||{};
   // 方向首尾只检查原裁剪阅读轴；不把外加白边当作完整性证据。
   const a=(b.x0-offset)/scale,z=(b.x1-offset)/scale;
   const complete=a>=1&&z<=width-1;
   const finiteBox=[b.x0,b.y0,b.x1,b.y1].every(Number.isFinite)&&b.x1>b.x0&&b.y1>b.y0;
   const horizontal=(b.x1-b.x0)>(text==='0'?.35:1.3)*(b.y1-b.y0);
   const directionAligned=horizontal&&(text.length>1||side==='left'||side==='right');
   const numericWords=(line.words||[]).filter(w=>/[0-9]/.test(w.text||''));
   const confidence=Math.min(line.confidence||0,...numericWords.map(w=>Number.isFinite(w.confidence)?w.confidence:0));
   return {side,text,confidence,complete,directionAligned,
    clear:confidence>=90&&complete&&finiteBox&&directionAligned&&/^(0|[1-9][0-9]*)$/.test(text),
    box:{x0:a,y0:(b.y0-offset)/scale,x1:z,y1:(b.y1-offset)/scale},
    reason:!finiteBox?'OCR字框无效':!complete?'首尾贴近裁切边界，可能截断':!directionAligned?'文字方向不明确，不能确认为竖向标记':confidence<90?'OCR置信度不足90':'完整可见的OCR候选（未经水印校验）'};
  }).filter(o=>o.text.length<=80);
 }

 function sourceBox(box,rect,rotation){
  const [l,t,r,b]=rect;
  return rotation===-90?[l+(r-l)-box.y1,t+box.x0,l+(r-l)-box.y0,t+box.x1]:[l+box.y0,t+(b-t)-box.x1,l+box.y1,t+(b-t)-box.x0];
 }
 function overlap(a,b){
  const area=x=>Math.max(0,x[2]-x[0])*Math.max(0,x[3]-x[1]);
  return area([Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])])/Math.max(1,Math.min(area(a),area(b)));
 }
 function locate(observations){
  const groups=[];
  for(const o of observations){
   if(!Array.isArray(o.sourceBox)||o.sourceBox.length!==4||!o.sourceBox.every(Number.isFinite))continue;
   const matches=groups.filter(g=>g.some(p=>overlap(p.sourceBox,o.sourceBox)>=.5));
   if(!matches.length)groups.push([o]);
   else{const first=matches[0];first.push(o);for(const g of matches.slice(1)){first.push(...g);groups.splice(groups.indexOf(g),1)}}
  }
  groups.sort((a,b)=>Math.min(...a.map(o=>o.sourceBox[1]))-Math.min(...b.map(o=>o.sourceBox[1]))||Math.min(...a.map(o=>o.sourceBox[0]))-Math.min(...b.map(o=>o.sourceBox[0])));
  return groups.flatMap((group,i)=>group.map(o=>({...o,regionId:'region-'+String(i+1).padStart(3,'0')})));
 }
 return {bounds,classify,lines,observation,sourceBox,locate,MAX_PIXELS};
})();
if(typeof module!=='undefined')module.exports=VisibleText;
