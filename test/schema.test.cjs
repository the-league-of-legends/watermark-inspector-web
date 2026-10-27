const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const schema=require('../src/schema.js'),codec=require('../src/codec.js'),game=require('../watermark.schema.json'),other=require('../examples/other-project.schema.json');
const identity={userId:'9223372036854775807',gameId:10013,capturedAt:1792410000};
function decoded(rule,values,rules=[rule]){const bytes=schema.encode(rule,values),raw=codec.readPayload(bytes);return schema.resolve({detected:true,...raw},schema.registry(rules));}
test('SHA256与标准实现一致，规则规范化与目录/缩进无关',()=>{
 for(const text of ['','abc','😀'.repeat(33),'中文'.repeat(100)])assert.equal(schema.sha256(text),crypto.createHash('sha256').update(text).digest('hex'));
 const a=schema.compile(game),b=schema.compile(JSON.parse(JSON.stringify(game,null,4)));assert.equal(a.fingerprint,b.fingerprint);assert.equal(a.usedBits,105);
 assert.equal(schema.compile(a.rule).fingerprint,a.fingerprint);
 assert.notEqual(schema.compile({...game,schemaVersion:2}).fingerprint,a.fingerprint);
 assert.notEqual(schema.compile({...game,projectKey:'other'}).fingerprint,a.fingerprint);
 const renamed=structuredClone(game);renamed.fields[0].key='accountId';assert.notEqual(schema.compile(renamed).fingerprint,a.fingerprint);
});
test('不同项目输出不同字段，长整数不丢精度，未知/旧规则不硬套',()=>{
 assert.deepEqual(decoded(game,identity).payload,identity);
 const values={accountId:'1234567890123456',tenantId:7,state:'new',tag:'😀',active:false};assert.deepEqual(decoded(other,values).payload,values);
 const r=decoded(game,identity,[other]);assert.equal(r.status,'unknown_schema');assert.equal(r.payload,null);
 const old={...game,schemaVersion:2};assert.equal(decoded(game,identity,[old]).status,'unknown_schema');assert.equal(decoded(game,identity,[old,game]).status,'decoded');
});
test('容量、类型、未知属性、缺字段、溢出拒绝而不是截断',()=>{
 assert.throws(()=>schema.compile({...game,fields:[{key:'a',type:'uint',bits:64},{key:'b',type:'uint',bits:64}]}));
 assert.throws(()=>schema.compile({...game,command:'curl test'}));assert.throws(()=>schema.encode(game,{...identity,userId:9007199254740992}));
 assert.throws(()=>schema.encode(game,{...identity,userId:'9223372036854775808'}));assert.throws(()=>schema.encode(game,{...identity,extra:1}));assert.throws(()=>schema.encode(game,{userId:'1'}));assert.throws(()=>schema.encode(game,{...identity,capturedAt:1792410001}));
 assert.throws(()=>schema.encode(other,{accountId:'1',tenantId:0,state:'new',tag:'你好',active:true}));assert.throws(()=>schema.encode(other,{accountId:'1',tenantId:0,state:'new',tag:'\ud800',active:true}));
});
test('有符号整数、hex字节串、布尔、空字符串及UTF8按字节保留',()=>{
 const rule={projectKey:'types',schemaVersion:1,fields:[{key:'signed',type:'int',bits:8},{key:'bytes',type:'bytes',maxBytes:3},{key:'text',type:'string',maxBytes:4},{key:'ok',type:'bool'}]};
 for(const text of ['','中','😀','\ufeff'])assert.deepEqual(decoded(rule,{signed:-128,bytes:'00abff',text,ok:false}).payload,{signed:-128,bytes:'00abff',text,ok:false});
 assert.throws(()=>schema.encode(rule,{signed:-129,bytes:'abc',text:'',ok:1}));
});
test('BCH码字、CRC失败拒绝，规则无关的完整性检查先行',()=>{
 const bytes=schema.encode(game,identity);assert.equal(codec.hex(codec.bchDecode(codec.bchEncode(bytes)).message),codec.hex(bytes));
 const changed=bytes.slice();changed[4]^=1;assert.equal(codec.readPayload(changed),null);
 const poison=bytes.slice(),bits=Uint8Array.from({length:211},(_,i)=>(poison[i>>3]>>(i&7))&1);bits[180]=1;
 let crc=0xb704ce;for(const bit of bits.slice(0,187)){const top=(crc>>>23)^bit;crc=(crc<<1)&0xffffff;if(top)crc^=0x864cfb;}
 for(let i=0;i<24;i++)bits[187+i]=(crc>>>i)&1;poison.fill(0);bits.forEach((b,i)=>{if(b)poison[i>>3]|=1<<(i&7)});
 assert.equal(schema.resolve({detected:true,...codec.readPayload(poison)},schema.registry([game])).status,'invalid_payload');
});
test('GHCV8实际单帧像素盲解码；缺规则可定位但不输出身份',()=>{
 const bytes=schema.encode(other,{accountId:'1234567890123456',tenantId:2,state:'open',tag:'demo',active:true}),tile=codec.makeTile(bytes),width=1080,height=2400,rgba=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let t=((y%512)*544+x%544)*4,p=(y*width+x)*4;for(let i=0;i<3;i++)rgba[p+i]=tile[t+i]+236;rgba[p+3]=255;}
 const r=codec.decodeImage(rgba,width,height,{timeoutMs:5000,schemas:schema.registry([other])});assert.equal(r.detected,true);assert.equal(r.status,'decoded');assert.equal(r.payload.tag,'demo');assert.equal(r.payload.accountId,'1234567890123456');assert.ok(r.minObservations>=5);
 const unknown=codec.decodeImage(rgba,width,height,{timeoutMs:5000});assert.equal(unknown.detected,true);assert.equal(unknown.status,'unknown_schema');assert.equal(unknown.payload,null);assert.equal(unknown.userId,undefined);
});

test('分发包核心与Web逐字节一致；不通过不同版本镜像解释截图',()=>{
 const fs=require('node:fs');for(const name of ['schema.js','codec.js'])assert.equal(fs.readFileSync(require.resolve('../src/'+name),'utf8'),fs.readFileSync(require.resolve('../skills/watermark-decode/scripts/core/'+name),'utf8'));
});
