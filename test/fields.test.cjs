const {test} = require('node:test');
const assert = require('node:assert/strict');
const fields = require('../src/fields.js');

test('GHCV6/7适配器保留账号字符串并区分字段含义', () => {
  const value = {detected:true, protocol:'GHCV7', userId:'9223372036854775807', loggedIn:true,
    gameId:20006, timeStartUtc:1792650540, timeEndUtc:1792650569, elapsedMs:300, diagnostics:{}};
  const all = fields.fromResult(value);
  assert.equal(all.find(f => f.key === 'userId').value, value.userId);
  assert.equal(all.find(f => f.key === 'gameId').label, '子游戏 ID');
  assert.equal(fields.fromResult({...value,protocol:'GHCV6'}).find(f => f.key === 'gameId').label, '游戏 ID（旧版主游戏）');
  assert.equal(all.some(f => ['elapsedMs','diagnostics','protocol'].includes(f.key)), false);
});
test('自定义名称、未知字段、嵌套值不丢失', () => {
  const nested = {traceId:'12345678901234567890', extra:['x','y']};
  const input = [{key:'tenant',label:'业务侧很长的名称'.repeat(20),type:'string',value:'<img src=x onerror=alert(1)>'},
    {key:'details',label:'附加信息',type:'json',value:nested}];
  assert.deepEqual(fields.fromResult({detected:true,fields:input}),input);
  assert.deepEqual(JSON.parse(fields.format(input[1])),nested);
  assert.equal(fields.fromResult({detected:true,sessionToken:'sample'})[0].label,'sessionToken');
  assert.equal(fields.format(input[0]),input[0].value);
});
test('失败结果没有字段；未登录和空值有明确显示', () => {
  assert.deepEqual(fields.fromResult({detected:false,fields:[{key:'userId',value:'744'}]}),[]);
  assert.equal(fields.format({type:'identity',value:null}),'未登录');
  assert.equal(fields.format({value:null}),'—');
  assert.equal(fields.format({value:false}),'否');
});

test('未知键与原型同名时仍按普通字段处理',()=>{
  for(const key of ['constructor','toString','__proto__']){
    const value=JSON.parse('{"detected":true,"'+key+'":"business-value"}');
    const field=fields.fromResult(value)[0];assert.equal(field.key,key);assert.equal(field.value,'business-value');
  }
});
