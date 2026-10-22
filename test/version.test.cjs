const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/version.js'),'utf8');
function environment(protocol='https:',remote={buildId:'1234567890abcdef',protocols:['GHCV6','GHCV7']}) {
  const nodes = new Map(), requests=[];
  const $ = id => {if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{remove(){},add(){}}});return nodes.get(id);};
  const context = {location:{protocol,href:'https://example.test/tool/',hostname:'example.test'}, BUILD_INFO:{buildId:'abcdef1234567890',protocols:['GHCV6','GHCV7']},
    $, URL, AbortController, setTimeout,clearTimeout,Date, window:{addEventListener(){}},
    fetch:async(url,options)=>{requests.push({url:String(url),options});if(remote instanceof Error)throw remote;return {ok:true,json:async()=>remote};}};
  vm.createContext(context);vm.runInContext(source,context);return {context,nodes,requests};
}
test('仅同源静态GET检测新版，不包含媒体或载荷', async () => {
  const e=environment();await vm.runInContext('versionRequest',e.context);
  assert.equal(e.requests.length,1);const request=e.requests[0];
  assert.equal(request.url,'https://example.test/tool/version.json');
  assert.equal(request.options.cache,'no-store');assert.equal(request.options.credentials,'omit');
  assert.equal(request.options.redirect,'error');assert.equal(request.options.body,undefined);
  assert.equal(e.nodes.get('version-state').textContent,'发现新版');
});
test('离线和清单错误不阻断解码，不自动刷新',async()=>{
  for(const remote of [Error('offline'),{buildId:'invalid',protocols:[]}]){
    const e=environment('https:',remote);await vm.runInContext('versionRequest',e.context);
    assert.match(e.nodes.get('version-state').textContent,/可继续离线识别/);
  }
  const local=environment('file:');assert.equal(local.requests.length,0);
});

test('同版本不显示更新，检测合并并限制焦点重试频率',async()=>{
  const e=environment('https:',{buildId:'abcdef1234567890',protocols:['GHCV6','GHCV7']});
  await vm.runInContext('versionRequest',e.context);
  assert.equal(e.nodes.get('version-state').textContent,'已检查版本');
  await vm.runInContext('checkVersion()',e.context);assert.equal(e.requests.length,1);
  await vm.runInContext('checkVersion(true)',e.context);assert.equal(e.requests.length,2);
});
