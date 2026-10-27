const {test}=require('node:test');
const assert=require('node:assert/strict');
const fields=require('../src/fields.js');
test('GHCV6/7均保留原字段名、长账号与原始类型，不翻译或转时间',()=>{
 for(const protocol of ['GHCV6','GHCV7']) {
  const payload={userId:'9223372036854775807',loggedIn:true,gameId:20006,timeStartUtc:1792650540,timeEndUtc:1792650569};
  const all=fields.fromResult({detected:true,protocol,...payload,elapsedMs:300,diagnostics:{},regionLayout:{regions:[]}});
  assert.deepEqual(fields.toPayload(all),payload);
  for(const f of all)assert.equal(f.label,f.key);
  assert.equal(fields.format(all.find(f=>f.key==='loggedIn')),'true');
  assert.equal(fields.format(all.find(f=>f.key==='timeStartUtc')),'1792650540');
  assert.equal(fields.format(all.find(f=>f.key==='userId')),'"9223372036854775807"');
 }
});
test('自定义字段忽略业务名称与类型提示，嵌套对象和数组完整保留',()=>{
 const input=[{key:'tenant',label:'定制名称',type:'datetime',value:'<img src=x onerror=alert(1)>'},
 {key:'details',value:{traceId:'12345678901234567890',extra:['x','y'],empty:{}}}];
 const all=fields.fromResult({detected:true,fields:input});
 assert.equal(all[0].label,'tenant');assert.equal(all[0].type,'string');
 assert.deepEqual(fields.toPayload(all),{tenant:input[0].value,details:input[1].value});
 assert.deepEqual(JSON.parse(fields.format(all[1])),input[1].value);
});
test('失败不暴露字段，null、false、0、空字符串与空容器不丢失',()=>{
 assert.deepEqual(fields.fromResult({detected:false,fields:[{key:'userId',value:'744'}]}),[]);
 const payload={a:null,b:false,c:0,d:'',e:[],f:{}};
 assert.deepEqual(fields.toPayload(fields.fromResult({detected:true,...payload})),payload);
 for(const value of Object.values(payload))assert.equal(fields.format({value}),JSON.stringify(value,null,2));
});
test('原型同名字段与特殊字符键在JSON中原样保留',()=>{
 const value=JSON.parse('{"detected":true,"constructor":"x","__proto__":"y","a.b":{"a[0]":"z"}}');
 const output=fields.toPayload(fields.fromResult(value));
 assert.equal(Object.getPrototypeOf(output),Object.prototype);
 assert.equal(Object.hasOwn(output,'__proto__'),true);
 assert.deepEqual(JSON.parse(JSON.stringify(output)),JSON.parse('{"constructor":"x","__proto__":"y","a.b":{"a[0]":"z"}}'));
});
