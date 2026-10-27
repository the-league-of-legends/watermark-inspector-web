// 显式选择目标仓库才写入；仅同步水印规则、生成常量和共享解码资源。
import {copyFile,mkdir,readFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),targets={};
for(let i=0;i<args.length;i+=2){if(!['--android','--ios','--bugfix','--flutter'].includes(args[i])||!args[i+1])throw Error('Use --android / --ios / --bugfix / --flutter <repo>');targets[args[i].slice(2)]=resolve(args[i+1]);}
for(const [kind,repo] of Object.entries(targets)) {
 await access(repo+'/.git');
 const marker=kind==='flutter'?'/libs/lib_base_common':kind==='android'?'/bizs/biz.main/src/main/java/com/tencent/gamehelper/CaptureChromaCodec.java':kind==='ios'?'/src/Main/Classes/Features/CaptureDiagnostics/GHPCaptureChromaCodec.m':'/scripts/ai_bugfix/capture_identity.py';
 await access(repo+marker);
}
execFileSync(process.execPath,[root+'scripts/sync-skill.mjs']);
const temp=await mkdtemp(tmpdir()+'/watermark-schema-');
try{
 execFileSync(process.execPath,[root+'scripts/generate-native.mjs',root+'watermark.schema.json',temp]);
 for(const [kind,repo] of Object.entries(targets)){
  for(const f of ['watermark.schema.json','watermark.analysis.json'])await copyFile(root+f,repo+'/'+f);
  if(kind==='flutter')continue;
  if(kind==='bugfix')for(const f of ['codec.js','schema.js'])await copyFile(root+'src/'+f,repo+'/scripts/ai_bugfix/watermark/'+f);
  else {
   const tools=repo+(kind==='ios'?'/Scripts/capture_watermark/':'/scripts/capture_watermark/');await mkdir(tools,{recursive:true});await copyFile(temp+'/vectors.json',tools+'ghcv8-vectors.json');
   if(kind==='android'){
    await copyFile(temp+'/CaptureWatermarkSchema.java',repo+'/bizs/biz.main/src/main/java/com/tencent/gamehelper/CaptureWatermarkSchema.java');
    await mkdir(tools+'generic/core',{recursive:true});for(const f of ['watermark_decode.py','decode.cjs'])await copyFile(root+'skills/watermark-decode/scripts/'+f,tools+'generic/'+f);
    for(const f of ['codec.js','schema.js'])await copyFile(root+'src/'+f,tools+'generic/core/'+f);
    await copyFile(root+'LICENSE.upstream',tools+'generic/core/LICENSE.upstream');
   }else await copyFile(temp+'/GHPCaptureWatermarkSchema.h',repo+'/src/Main/Classes/Features/CaptureDiagnostics/GHPCaptureWatermarkSchema.h');
  }
 }
}finally{await rm(temp,{recursive:true,force:true});}
