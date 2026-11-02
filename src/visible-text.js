// 独立明文候选：从不改写已校验载荷，不推导游戏/时间。
const VisibleText = (() => {
 const MAX_PIXELS=4000000;
 function bounds(data,w,h) {
  // 只去除连续、均匀的暗色电脑外框；不自动裁掉白色业务内容。
  const row=y=>{let lo=255,hi=0;for(let x=0;x<w;x+=Math.max(1,Math.floor(w/200))){let i=(y*w+x)*4;for(let c=0;c<3;c++){lo=Math.min(lo,data[i+c]);hi=Math.max(hi,data[i+c])}}return hi<70&&hi-lo<8};
  const col=x=>{let lo=255,hi=0;for(let y=0;y<h;y+=Math.max(1,Math.floor(h/200))){let i=(y*w+x)*4;for(let c=0;c<3;c++){lo=Math.min(lo,data[i+c]);hi=Math.max(hi,data[i+c])}}return hi<70&&hi-lo<8};
  let l=0,t=0,rr=w,b=h;while(t<h*.2&&row(t))t++;while(b>h*.8&&row(b-1))b--;while(l<w*.2&&col(l))l++;while(rr>w*.8&&col(rr-1))rr--;
  return [l,t,rr,b];
 }
 function classify(observations,maxValue='9223372036854775807') {
  const good=observations.filter(o=>o.clear&&o.complete&&/^(0|[1-9][0-9]*)$/.test(o.text)&&o.text.length<=20&&BigInt(o.text)<=BigInt(maxValue));
  const ids=[...new Set(good.map(o=>o.text))];
  if(ids.length>1)return {status:'conflict',confidence:null};
  if(ids[0]==='0')return {status:'unlogged',confidence:null};
  if(ids.length===1)return {status:'candidate',account:ids[0],confidence:new Set(good.map(o=>o.side)).size===2?'dual_agree':'single_clear'};
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
   const edgeBand=side==='left'?(b.y1/scale>=height*.5):(b.y0/scale<=height*.5);
   const finiteBox=[b.x0,b.y0,b.x1,b.y1].every(Number.isFinite)&&b.x1>b.x0&&b.y1>b.y0;
   const horizontal=(b.x1-b.x0)>(text==='0'?.35:1.3)*(b.y1-b.y0);
   const numericWords=(line.words||[]).filter(w=>/[0-9]/.test(w.text||''));
   const confidence=Math.min(line.confidence||0,...numericWords.map(w=>Number.isFinite(w.confidence)?w.confidence:0));
   return {side,text,confidence,complete,
    clear:confidence>=90&&complete&&finiteBox&&edgeBand&&horizontal&&/^(0|[1-9][0-9]*)$/.test(text),
    box:{x0:a,y0:(b.y0-offset)/scale,x1:z,y1:(b.y1-offset)/scale},
    reason:!finiteBox?'OCR字框无效':!complete?'首尾贴近裁切边界，可能截断':!edgeBand||!horizontal?'文字方向或位置不符合侧边布局':confidence<90?'OCR置信度不足90':'完整可见的OCR候选（未经水印校验）'};
  }).filter(o=>o.text.length<=80);
 }
 return {bounds,classify,lines,observation,MAX_PIXELS};
})();
if(typeof module!=='undefined')module.exports=VisibleText;
