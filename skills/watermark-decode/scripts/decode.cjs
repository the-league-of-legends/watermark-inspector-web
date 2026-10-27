'use strict';
// 输入只有原始像素和显式规则，不根据图片名、日志或画面文字推测身份。
const fs=require('node:fs'),codec=require('./core/codec.js'),schema=require('./core/schema.js');
const started=performance.now();
try {
 const all=fs.readFileSync(0),size=all.readUInt32LE(0);if(size>1024*1024||size>all.length-4)throw Error('Invalid header');
 const meta=JSON.parse(all.subarray(4,4+size).toString('utf8'));
 const rules=schema.registry(meta.rules||[]),left=meta.timeoutMs-(performance.now()-started);
 if(left<=0){process.stdout.write(JSON.stringify({detected:false,reason:'decode_timeout'}));}
 else process.stdout.write(JSON.stringify(codec.decodeImage(all.subarray(4+size),meta.width,meta.height,{timeoutMs:left,schemas:rules,fullSearch:meta.fullSearch!==false})));
} catch(e) {process.stdout.write(JSON.stringify({detected:false,reason:'invalid_rules_or_input',detail:String(e.message).slice(0,300)}));process.exitCode=2;}
