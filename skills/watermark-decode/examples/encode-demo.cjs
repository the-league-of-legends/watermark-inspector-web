#!/usr/bin/env node
// 独立可运行合成示例；PNG打包只依赖Node标准库。
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const s=require('../scripts/core/schema.js'),c=require('../scripts/core/codec.js');
const rule=require('./watermark.schema.json');
const out=path.resolve(process.argv[2]||'watermark-demo');fs.mkdirSync(out); // 不覆盖已有目录
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let j=0;j<8;j++)value=(value>>>1)^((value&1)?0xedb88320:0)}return (value^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([len,name,data,crc])}
function png(w,h,rgba){const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;const scan=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++)rgba.copy(scan,y*(w*4+1)+1,y*w*4,(y+1)*w*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))])}
const compiled=s.compile(rule),payload={accountId:'1234567890123456',businessId:42,capturedAt:1792410000};
const message=s.encode(rule,payload),codeword=c.bchEncode(message),tile=c.makeTile(message);
const w=1080,h=2400,image=Buffer.alloc(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const p=(y*w+x)*4,t=((y%512)*544+x%544)*4;
 // makeTile的RGB已经预乘alpha，不能再乘一次alpha。
 for(let k=0;k<3;k++)image[p+k]=Math.round(240*(1-tile[t+3]/255)+tile[t+k]);image[p+3]=255;
}
const vector={sourceRule:rule,fingerprint:compiled.fingerprint,canonical:compiled.canonical,sha256:compiled.sha256,usedBits:compiled.usedBits,vectors:[{payload,messageHex:c.hex(message),codewordHex:c.hex(codeword),textureSha256:crypto.createHash('sha256').update(tile).digest('hex')}]};
fs.writeFileSync(path.join(out,'vectors.json'),JSON.stringify(vector,null,2)+'\n');
fs.writeFileSync(path.join(out,'tile-premultiplied.rgba'),tile);
fs.writeFileSync(path.join(out,'sample.png'),png(w,h,image));
fs.writeFileSync(path.join(out,'watermark.schema.json'),JSON.stringify(rule,null,2)+'\n');
console.log(JSON.stringify({output:out,fingerprint:compiled.fingerprint,image:'sample.png',note:'全部为合成数据，不代表业务页面或平台压缩验收'},null,2));
