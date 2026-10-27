// 从项目规则生成两端业务适配常量及测试向量；纹理与BCH实现不在此重复生成。
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),s=require('../src/schema.js'),c=require('../src/codec.js');
const [rulePath,outPath]=process.argv.slice(2);if(!rulePath||!outPath)throw Error('Usage: node generate-native.mjs schema.json output-dir');
const raw=JSON.parse(await readFile(rulePath,'utf8')),compiled=s.compile(raw),out=resolve(outPath);await mkdir(out,{recursive:true});
if(compiled.fields.some(f=>! /^[A-Za-z][A-Za-z0-9]*$/.test(f.key)))throw Error('Native constants require identifier field keys');
if(raw.projectKey==='gamehelper' && compiled.fields.map(f=>`${f.key}:${f.type}:${f.bits}`).join(',')!=='userId:uint:63,gameId:uint:16,capturedAt:time:26')throw Error('GameHelper native binding requires explicit source migration for changed field shapes');
const uid=compiled.fields.find(f=>f.key==='userId'),game=compiled.fields.find(f=>f.key==='gameId');
let offset=68;const fields=compiled.fields.map(f=>{const r={key:f.key,offset,bits:f.bits};offset+=f.bits;return r});
const name=k=>k.replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase();
const java=`package com.tencent.gamehelper;\n\n// 自动生成：来源 watermark.schema.json；修改规则后重新生成，勿手改位布局。\nfinal class CaptureWatermarkSchema {\n    static final long FINGERPRINT = 0x${compiled.fingerprint}L;\n${fields.map(f=>`    static final int ${name(f.key)}_OFFSET = ${f.offset};\n    static final int ${name(f.key)}_BITS = ${f.bits};`).join('\n')}\n    static final long UID_MIN = ${uid?.min||0}L;\n    static final long UID_MAX = ${uid?.max||0}L;\n    static final long GAME_MIN = ${game?.min||0}L;\n    static final long GAME_MAX = ${game?.max||0}L;\n    static final long EPOCH = ${compiled.rule.fields.find(f=>f.type==='time')?.epoch||0}L;\n    static final int TIME_STEP = ${compiled.rule.fields.find(f=>f.type==='time')?.stepSeconds||1};\n}\n`;
const objc=`// 自动生成：来源 watermark.schema.json；仅供内部包的编码实现使用。\n#if defined(APP_PUBLISH_VERSION) && APP_PUBLISH_VERSION == 0\nstatic const uint64_t kWatermarkSchemaFingerprint = 0x${compiled.fingerprint}ULL;\n${fields.map(f=>`static const NSUInteger kWatermark${f.key[0].toUpperCase()+f.key.slice(1)}Offset = ${f.offset};\nstatic const NSUInteger kWatermark${f.key[0].toUpperCase()+f.key.slice(1)}Bits = ${f.bits};`).join('\n')}\nstatic const uint64_t kWatermarkUidMin = ${uid?.min||0}ULL;\nstatic const uint64_t kWatermarkUidMax = ${uid?.max||0}ULL;\nstatic const uint64_t kWatermarkGameMin = ${game?.min||0}ULL;\nstatic const uint64_t kWatermarkGameMax = ${game?.max||0}ULL;\nstatic const int64_t kWatermarkEpoch = ${compiled.rule.fields.find(f=>f.type==='time')?.epoch||0}LL;\nstatic const NSUInteger kWatermarkTimeStep = ${compiled.rule.fields.find(f=>f.type==='time')?.stepSeconds||1};\n#endif\n`;
await writeFile(out+'/CaptureWatermarkSchema.java',java);await writeFile(out+'/GHPCaptureWatermarkSchema.h',objc);
const vectors=[];
if(compiled.rule.projectKey==='gamehelper')for(const userId of ['0','74498','9223372036854775807'])for(const gameId of [10001,10002,10013,10038]){
 const payload={userId,gameId,capturedAt:1792410000},bytes=s.encode(raw,payload);vectors.push({payload,messageHex:c.hex(bytes),codewordHex:c.hex(c.bchEncode(bytes)),textureSha256:require('node:crypto').createHash('sha256').update(c.makeTile(bytes)).digest('hex')});}
await writeFile(out+'/vectors.json',JSON.stringify({sourceRule:raw,fingerprint:compiled.fingerprint,sha256:compiled.sha256,canonical:compiled.canonical,usedBits:compiled.usedBits,fields,vectors},null,2)+'\n');
