const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const fields=require('../src/fields.js');
const source=fs.readFileSync(require.resolve('../src/local-analysis.js'),'utf8');
const renderer=source.slice(source.indexOf('function renderPayload(fields)'),source.indexOf("$('copy-payload').onclick"));
function render(result) {
 class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.classList={toggle:(key,value)=>{this[key]=value}};}
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(){this.children=[]}
 }
 const ids=Object.fromEntries(['payload-json','copy-payload','payload-section'].map(id=>[id,new Element()]));
 const context={result,WatermarkFields:fields,$:id=>ids[id],document:{createElement:tag=>new Element(tag)}};
 vm.runInNewContext(renderer+'\nrenderPayload(WatermarkFields.fromResult(result));',context);
 return ids;
}
test('只展示完整 JSON，保留原始字段名、类型及嵌套内容',()=>{
 const payload={tenant:'a',timeStartUtc:1792410000,enabled:false,details:{items:[1,'x'],empty:{}},extra:[]};
 const ids=render({detected:true,protocol:'GHCV7',...payload,regionLayout:{status:'estimated'}});
 assert.deepEqual(JSON.parse(ids['payload-json'].textContent),payload);
 assert.equal(fs.readFileSync(require.resolve('../src/index.html'),'utf8').includes('id="payload-fields"'),false);
});
test('长账号和类似 HTML 的内容只赋值给文本节点',()=>{
 const ids=render({detected:true,userId:'9223372036854775807',extra:'<img src=x onerror=alert(1)>'});
 assert.equal(JSON.parse(ids['payload-json'].textContent).extra,'<img src=x onerror=alert(1)>');
 assert.equal(JSON.parse(ids['payload-json'].textContent).userId,'9223372036854775807');
});
test('清空或识别失败时清空JSON并禁用复制',()=>{
 for(const result of [null,{detected:false,userId:'old'}]){
 const ids=render(result);assert.equal(ids['payload-json'].textContent,'');
 assert.equal(ids['copy-payload'].disabled,true);assert.equal(ids['payload-section'].hidden,true);
 }
});

test('GHCV8未匹配规则不显示空JSON或旧身份，已匹配时展示项目自己的payload',()=>{
 const unknown=render({detected:true,protocol:'GHCV8',status:'unknown_schema',payload:null});assert.equal(unknown['payload-json'].textContent,'');assert.equal(unknown['copy-payload'].disabled,true);
 const decoded=render({detected:true,protocol:'GHCV8',status:'decoded',payload:{accountId:'123',tag:'demo'}});assert.deepEqual(JSON.parse(decoded['payload-json'].textContent),{accountId:'123',tag:'demo'});
});
