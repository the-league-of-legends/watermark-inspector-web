const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const schema=require('../src/schema.js'),codec=require('../src/codec.js');
const {generate}=require('../skills/watermark-decode/scripts/generate_rules.cjs');
const rule=require('../examples/other-project.schema.json'),compiled=schema.compile(rule);
const code=`const schemaFingerprint = "${compiled.fingerprint}";`;
const source={file:'fixture.js',text:code};
test('从完整产物恢复任意字段规则，核对长账号、消息、码字及纹理',()=>{
 const payload={accountId:'9223372036854775807',tenantId:7,state:'open',tag:'😀',active:false};
 const message=schema.encode(rule,payload),artifact={sourceRule:rule,fingerprint:compiled.fingerprint,canonical:compiled.canonical,sha256:compiled.sha256,vectors:[{payload,messageHex:codec.hex(message),codewordHex:codec.hex(codec.bchEncode(message)),textureSha256:require('node:crypto').createHash('sha256').update(codec.makeTile(message)).digest('hex')}]};
 const result=generate({artifact,verifySources:[source]});assert.equal(result.status,'rules_ready');assert.deepEqual(result.schema,rule);assert.equal(result.verification.vectorCount,1);
 artifact.vectors[0].messageHex='00';assert.throws(()=>generate({artifact}),/测试向量/);
});
test('不从普通十六进制数猜指纹；格式通过不足以确认源码对应',()=>{
 assert.equal(generate({artifact:rule}).status,'needs_source_verification');
 assert.throws(()=>generate({artifact:rule,verifySources:[{file:'a.js',text:'const uid="'+compiled.fingerprint+'";'}]}),/没有.*指纹/);
 assert.throws(()=>generate({artifact:rule,verifySources:[{file:'a.h',text:'static const uint64_t kWatermarkSchemaFingerprint = 0x0000000000000000ULL;'}]}),/不匹配/);
 assert.throws(()=>generate({artifact:{...rule,fields:[{key:'big',type:'uint',bits:64},{key:'more',type:'uint',bits:64}]}}),/119/);
});
test('命令输出可被独立使用；失败不覆盖既有规则、缺证据不落文件',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rules-generate-'));
 try {
  const input=path.join(root,'candidate.json'),verify=path.join(root,'encoder.js'),out=path.join(root,'watermark.schema.json');
  fs.writeFileSync(input,JSON.stringify(rule));fs.writeFileSync(verify,code);
  const cli=path.resolve('skills/watermark-decode/scripts/watermark_decode.py');
  const run=(args)=>{const p=spawnSync('python3',[cli,'generate-rules',...args],{encoding:'utf8',cwd:root});assert.ok(p.stdout,p.stderr);return JSON.parse(p.stdout)};
  const args=['--source',input,'--output',out];
  assert.equal(run(args).status,'needs_source_verification');assert.equal(fs.existsSync(out),false);
  assert.equal(run([...args,'--verify-source',verify]).status,'rules_ready');assert.deepEqual(JSON.parse(fs.readFileSync(out)),rule);
  const protectedText='{"keep":"local work"}';fs.writeFileSync(out,protectedText);
  assert.equal(run([...args,'--verify-source',verify]).status,'invalid_schema');assert.equal(fs.readFileSync(out,'utf8'),protectedText);
  assert.equal(run(['--project',root,'--source',path.join(root,'missing.json')]).status,'needs_source_analysis');
  fs.writeFileSync(input,'{"projectKey":"a","projectKey":"b"}');assert.match(run(args).warning,/重复键/);
 } finally {fs.rmSync(root,{recursive:true,force:true})}
});
