const {test}=require('node:test');
const assert=require('node:assert/strict');
const codec=require('../src/codec.js');
const vectors=require('./vectors.json');
// Public Android preview format, generated from synthetic protocol vectors only.
function image(word,height=3200,rightWord=word,cell=7){
 const width=1440,rgba=new Uint8Array(width*height*4).fill(255),header=0x4748434531d39a65n;
 for(let i=0;i<rgba.length;i+=4)rgba[i]=rgba[i+1]=rgba[i+2]=220;
 for(const [start,code] of [[0,word],[width-cell*5,rightWord]])for(let y=0;y<height;y++)for(let col=0;col<4;col++){
  const row=Math.floor(y/cell)%152;
  let bit;if(row<16)bit=Number(header>>BigInt(row*4+col)&1n);
  else if(row>=144)bit=Number(~header>>BigInt((row-144)*4+col)&1n);
  else{const p=(row-16)*4+col,index=(p*73+19)&511;bit=((code[index>>3]>>(index&7))&1)^(codec.hash(p)&1);}
  const value=Math.round(220*(1-8/255)+(bit?0:255)*8/255);
  for(let x=start+Math.floor(cell/2)+col*cell;x<start+Math.floor(cell/2)+(col+1)*cell;x++){const p=(y*width+x)*4;rgba[p]=rgba[p+1]=rgba[p+2]=value;}
 }
 return {rgba,width,height};
}
test('edge-only independent physical observations preserve complete GHCV6/7 payload',()=>{
 for(const vector of vectors){const im=image(codec.fromHex(vector.codeword));const result=codec.decodeImage(im.rgba,im.width,im.height,{timeoutMs:5000,fullSearch:false});
 assert.equal(result.detected,true);assert.equal(result.userId,vector.uid);assert.equal(result.diagnostics.transportProfile,'edge-v1-preview');assert.ok(result.minObservations>=5);}
});
test('less than five physical edge observations and deadline cannot return identity',()=>{
 const im=image(codec.fromHex(vectors[0].codeword),1600);
 for(const timeoutMs of [1,1000]){const r=codec.decodeImage(im.rgba,im.width,im.height,{timeoutMs,fullSearch:false});assert.equal(r.detected,false);assert.equal(r.userId,undefined);}
});
test('two independently valid contradictory edge strips reject identity',()=>{
 const im=image(codec.fromHex(vectors[0].codeword),6400,codec.fromHex(vectors[1].codeword));
 // Each side has six distinct complete packets. Neither side is allowed to win by ordering.
 const r=codec.decodeImage(im.rgba,im.width,im.height,{timeoutMs:10000,fullSearch:false});assert.equal(r.detected,false);assert.equal(r.reason,'conflicting_payloads');
});
test('GHCV8 edge transport requires exact schema and keeps long integers as strings',()=>{
 const schema=require('../src/schema.js'),rule=require('../watermark.schema.json');
 const expected={userId:'9223372036854775807',gameId:10013,capturedAt:1792410000};
 const im=image(codec.bchEncode(schema.encode(rule,expected)));
 const good=codec.decodeImage(im.rgba,im.width,im.height,{timeoutMs:5000,schemas:schema.registry([rule])});
 assert.equal(good.detected,true);assert.deepEqual(good.payload,expected);
 const missing=codec.decodeImage(im.rgba,im.width,im.height,{timeoutMs:5000});
 assert.equal(missing.detected,true);assert.equal(missing.status,'unknown_schema');assert.equal(missing.payload,null);
});
test('single edge crop with almost-uniform outer frame reports physical shortage, not an identity',()=>{
 const full=image(codec.fromHex(vectors[0].codeword)),width=149,height=full.height,rgba=new Uint8Array(width*height*4);
 for(let i=0;i<rgba.length;i+=4){rgba[i]=rgba[i+1]=rgba[i+2]=30;rgba[i+3]=255;}
 for(let y=0;y<height;y++)rgba.set(full.rgba.subarray((y*1440+1376)*4,(y*1440+1440)*4),y*width*4);
 rgba[((height-1)*width+width-1)*4]=31; // a single antialiased frame pixel must not move the ROI
 const r=codec.decodeImage(rgba,width,height,{timeoutMs:5000,fullSearch:false});
 assert.equal(r.detected,false);assert.equal(r.userId,undefined);assert.equal(r.reason,'insufficient_edge_observations');
 assert.equal(r.diagnostics.edgeObservationHint.minObservations,3);
});

test('edge geometry guides unfamiliar body scale without lowering the observation gate',()=>{
 const vector=vectors.find(v=>v.version===7),word=codec.fromHex(vector.codeword),im=image(word,3200,word,8);
 const tile=codec.makeTile(codec.fromHex(vector.payload));
 for(let y=0;y<im.height;y++)for(let x=40;x<im.width-40;x++){
   const p=(y*im.width+x)*4,t=((y%512)*544+x%544)*4;
   for(let k=0;k<3;k++)im.rgba[p+k]=tile[t+k]+236;
 }
 const scale=.60625,width=Math.round(im.width*scale),height=Math.round(im.height*scale),rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const sx=Math.max(0,Math.min(im.width-1,(x+.5)/scale-.5)),sy=Math.max(0,Math.min(im.height-1,(y+.5)/scale-.5));
   const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
   for(let k=0;k<4;k++)rgba[(y*width+x)*4+k]=Math.round(
     im.rgba[(iy*im.width+ix)*4+k]*(1-fx)*(1-fy)+im.rgba[(iy*im.width+Math.min(ix+1,im.width-1))*4+k]*fx*(1-fy)+
     im.rgba[(Math.min(iy+1,im.height-1)*im.width+ix)*4+k]*(1-fx)*fy+im.rgba[(Math.min(iy+1,im.height-1)*im.width+Math.min(ix+1,im.width-1))*4+k]*fx*fy);
 }
 const r=codec.decodeImage(rgba,width,height,{timeoutMs:5000,fullSearch:false});
 assert.equal(r.detected,true);assert.equal(r.userId,vector.uid);
 assert.equal(r.diagnostics.searchStrategy,'edge_geometry_guided_body');assert.ok(r.minObservations>=5);
});
test('three packets per side with different payloads must not become one accepted six-observation identity',()=>{
 const im=image(codec.fromHex(vectors[0].codeword),3200,codec.fromHex(vectors[1].codeword));
 // 模拟两侧经历不同对比度变化。强侧不能利用弱侧的计数凑足接受门槛。
 for(let y=0;y<im.height;y++)for(let x=im.width-35;x<im.width;x++){
   const p=(y*im.width+x)*4;for(let k=0;k<3;k++)im.rgba[p+k]=Math.max(0,Math.min(255,220+2*(im.rgba[p+k]-220)));
 }
 const r=codec.decodeImage(im.rgba,im.width,im.height,{timeoutMs:5000,fullSearch:false});
 assert.equal(r.detected,false);assert.equal(r.reason,'conflicting_payloads');assert.equal(r.userId,undefined);
});
test('a checked edge payload cannot escape the overall deadline during the body cross-check',()=>{
 const im=image(codec.fromHex(vectors[0].codeword));let delayed=false;
 const r=codec.decodeImage(im.rgba,im.width,im.height,{timeoutMs:2000,fullSearch:false,progress(stage){
   if(!delayed && stage==='同步定位与纠错校验'){delayed=true;const until=performance.now()+2100;while(performance.now()<until){}}
 }});
 assert.equal(delayed,true);assert.equal(r.detected,false);assert.equal(r.reason,'decode_timeout');assert.equal(r.userId,undefined);
});
test('invalid decoder budgets do not become unbounded work',()=>{
 for(const timeoutMs of [0,-1,NaN,Infinity,'5000']){
   const r=codec.decodeImage(new Uint8Array(4),1,1,{timeoutMs});assert.equal(r.detected,false);assert.equal(r.reason,'invalid_decode_budget');
 }
});
