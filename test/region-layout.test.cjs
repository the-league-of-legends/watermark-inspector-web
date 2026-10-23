const {test}=require('node:test');
const assert=require('node:assert/strict');
const {estimate}=require('../src/region-layout.js');
const codec=require('../src/codec.js');
const base={detected:true,diagnostics:{scale:1,cellPhaseX:0,cellPhaseY:0,tileShiftCellsX:0,tileShiftCellsY:0}};
const get=(width,height,bounds=[0,0,width,height],d={})=>estimate({...base,diagnostics:{...base.diagnostics,...d}},width,height,bounds);
test('完整铺排、稳定编号及导出矩形一致',()=>{
 const r=get(1088,1024);assert.equal(r.completeCount,4);assert.equal(r.partialCount,0);
 assert.deepEqual(r.regions.map(x=>[x.id,x.visibleRect.x,x.visibleRect.y]),[[1,0,0],[2,544,0],[3,0,512],[4,544,512]]);
 assert.equal(r.independentlyVerified,false);
 for(const a of r.regions)assert.deepEqual(a.visibleRect,a.tileRect);
});
test('平移和半屏包括四周残片，区域不重叠且覆盖整个参考范围',()=>{
 const r=get(800,978,[0,0,800,978],{cellPhaseX:27,cellPhaseY:19});
 assert.ok(r.partialCount>0);assert.equal(r.completeCount,1);
 const area=r.regions.reduce((s,a)=>s+a.visibleRect.width*a.visibleRect.height,0);assert.equal(area,800*978);
 for(let i=0;i<r.regions.length;i++)for(let j=i+1;j<r.regions.length;j++){
 const a=r.regions[i].visibleRect,b=r.regions[j].visibleRect;
 assert.ok(Math.min(a.x+a.width,b.x+b.width)<=Math.max(a.x,b.x)||Math.min(a.y+a.height,b.y+b.height)<=Math.max(a.y,b.y));
 }
});
test('只有残片仍可定位；尺寸完整不代表单区校验',()=>{
 const r=get(100,100);assert.equal(r.completeCount,0);assert.equal(r.partialCount,1);assert.equal(r.regions.length,1);
});
test('缩放、内容边界和浮点边界不生成幽灵区块',()=>{
 for(const scale of [1/3,.43,.5,2/3,1,1.5]){
 const w=544*scale,h=512*scale;
 const r=get(w*2,h*2,[0,0,w*2,h*2],{scale});assert.equal(r.regions.length,4);assert.equal(r.completeCount,4);
 }
 assert.equal(get(1088,1024,[0,0,1088+1e-8,1024+1e-8]).regions.length,4);
 assert.equal(get(1088,1024,[0,0,1088-1e-8,1024-1e-8]).completeCount,4);
 const r=get(1200,1300,[56,70,1144,1094],{cellPhaseX:56,cellPhaseY:70});assert.equal(r.completeCount,4);assert.equal(r.partialCount,0);
});
test('无效、未识别、超时、冲突不输出数量',()=>{
 for(const result of [{detected:false,reason:'decode_timeout'},{detected:false,reason:'conflicting_payloads'},{detected:true},{...base,diagnostics:{...base.diagnostics,scale:NaN}},{...base,diagnostics:{...base.diagnostics,scale:0}}]){
 const r=estimate(result,800,1000,[0,0,800,1000]);assert.equal(r.status,'unavailable');assert.deepEqual(r.regions,[]);assert.equal('completeCount' in r,false);
 }
 assert.equal(get(100,100,[0,0,0,0]).status,'unavailable');
});
test('纯色外框沿用已有内容边界，框不延伸到外框',()=>{
 const width=1128,height=1064,rgba=new Uint8ClampedArray(width*height*4);
 for(let y=20;y<1044;y++)for(let x=20;x<1108;x++){const p=(y*width+x)*4;rgba[p]=x%255;rgba[p+1]=y%255;rgba[p+3]=255;}
 const bounds=codec.evidenceBounds(rgba,width,height);assert.deepEqual(bounds,[20,20,1108,1044]);
 const r=get(width,height,bounds,{cellPhaseX:20,cellPhaseY:20});assert.equal(r.completeCount,4);
});
