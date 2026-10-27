#!/usr/bin/env node
// 只编译数据与核对常量／向量；不加载或执行项目源码。
const fs=require('node:fs'),crypto=require('node:crypto');
const schema=require('./core/schema.js'),codec=require('./core/codec.js');
function generate(request) {
  const artifact=request.artifact;
  const rule=artifact.sourceRule || (typeof artifact.canonical==='string'?JSON.parse(artifact.canonical):artifact);
  const compiled=schema.compile(rule),checks=[];
  if(artifact.fingerprint!==undefined) {
    if(String(artifact.fingerprint).toLowerCase()!==compiled.fingerprint)throw Error('规则与来源中的 fingerprint 不匹配');
    checks.push('artifact_fingerprint');
  }
  if(artifact.canonical!==undefined && artifact.canonical!==compiled.canonical)throw Error('规则与来源中的 canonical 不匹配');
  if(artifact.sha256!==undefined && artifact.sha256!==compiled.sha256)throw Error('规则与来源中的 SHA-256 不匹配');
  for(const source of request.verifySources||[]) {
    // 仅识别明确的指纹赋值，不从普通十六进制数字或文件名猜测。
    const pattern=/\b(?:FINGERPRINT|kWatermarkSchemaFingerprint|schemaFingerprint)\s*=\s*(?:0x([0-9a-fA-F]{16})(?:ULL|LL|UL|L|n)?|["']([0-9a-fA-F]{16})["'])\s*[;,]/g;
    const values=[...source.text.matchAll(pattern)].map(match=>(match[1]||match[2]).toLowerCase());
    if(!values.length)throw Error('核对文件没有受支持的显式规则指纹常量：'+source.file);
    if(values.some(value=>value!==compiled.fingerprint))throw Error('规则与编码常量指纹不匹配：'+source.file);
    checks.push('source_fingerprint');
  }
  let vectorCount=0;
  if(artifact.vectors!==undefined) {
    if(!Array.isArray(artifact.vectors)||artifact.vectors.length>256)throw Error('测试向量格式或数量无效');
    for(const vector of artifact.vectors) {
      if(typeof vector.messageHex!=='string'||typeof vector.codewordHex!=='string')throw Error('向量缺少 messageHex / codewordHex');
      const message=schema.encode(rule,vector.payload);
      if(codec.hex(message)!==vector.messageHex||codec.hex(codec.bchEncode(message))!==vector.codewordHex)throw Error('规则未通过来源测试向量');
      if(vector.textureSha256!==undefined && crypto.createHash('sha256').update(codec.makeTile(message)).digest('hex')!==vector.textureSha256)throw Error('规则未通过纹理测试向量');
      vectorCount++;
    }
    if(vectorCount)checks.push('source_vectors');
  }
  const verified=checks.includes('artifact_fingerprint')||checks.includes('source_fingerprint');
  return {status:verified?'rules_ready':'needs_source_verification',schema:rule,fingerprint:compiled.fingerprint,usedBits:compiled.usedBits,capacityBits:119,
    verification:{checks,vectorCount,scope:'仅核对所提供的源码常量或生成产物；不证明当前运行包或实际图片已使用此规则'},
    warning:verified?null:'格式通过，但缺少可核对的编码指纹；未写入规则文件。请继续读取编码实现，不能把计算出的指纹当作项目已使用的指纹。'};
}
module.exports={generate};
if(require.main===module) {
  try {const text=fs.readFileSync(0,'utf8');if(Buffer.byteLength(text)>4*1024*1024)throw Error('输入过大');process.stdout.write(JSON.stringify(generate(JSON.parse(text))));}
  catch(error){process.stdout.write(JSON.stringify({status:'invalid_schema',warning:error.message,nonBlocking:true}));process.exitCode=2;}
}
