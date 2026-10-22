const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const codec = require('../src/codec.js');
const vectors = require('./vectors.json');

test('Python 镜像向量：63位账号、位序、BCH码字及纹理逐字节一致', () => {
  for (const vector of vectors) {
    const payload = codec.fromHex(vector.payload), codeword = codec.bchEncode(payload);
    assert.equal(codec.hex(codeword), vector.codeword);
    const decoded = codec.readPayload(payload);
    assert.equal(decoded.userId, vector.uid);
    if (vector.version === 7) {
      assert.equal(decoded.protocol, 'GHCV7');
      assert.equal(decoded.gameId, vector.gameId);
      assert.equal('page' in decoded, false);
    }
    assert.equal(createHash('sha256').update(codec.makeTile(payload)).digest('hex'), vector.tileSha256);
  }
});

test('BCH40位纠错和总体偶校验位诊断', () => {
  for (const vector of vectors) {
    const broken = codec.fromHex(vector.codeword);
    for (let i = 0; i < 40; i++) broken[(i * 13) >> 3] ^= 1 << ((i * 13) & 7);
    broken[63] ^= 128;
    const result = codec.bchDecode(broken);
    assert.equal(codec.hex(result.message), vector.payload);
    assert.equal(result.correctedCount, 41); // 40个BCH位 + 1个独立偶校验位，不是t41。
  }
});

test('非法载荷与超界输入拒答', () => {
  for (const vector of vectors) {
    const payload = codec.fromHex(vector.payload);
    payload[25] ^= 128;
    assert.equal(codec.readPayload(payload), null);
  }
  assert.equal(codec.bchDecode(new Uint8Array(63)), null);
  assert.equal(codec.decodeImage(new Uint8Array(4), 10, 10).detected, false);
});

function synthetic(vector, shiftX = 0, shiftY = 0) {
  const tile = codec.makeTile(codec.fromHex(vector.payload)), width = 1080, height = 2400;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = ((((y - shiftY) % 512 + 512) % 512) * 544 + ((x - shiftX) % 544 + 544) % 544) * 4, p = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) rgba[p + c] = tile[t + c] + Math.floor(240 * 251 / 255);
    rgba[p + 3] = 255;
  }
  return {rgba, width, height};
}

test('单帧像素盲解码、平移与高位账号恢复', () => {
  for (const vector of [vectors[0], vectors[3], vectors.find(v => v.version === 7)]) {
    const image = synthetic(vector, 27, 19), result = codec.decodeImage(image.rgba, image.width, image.height);
    assert.equal(result.detected, true);
    assert.equal(result.userId, vector.uid);
    assert.equal(result.diagnostics.payloadHex, vector.payload);
  }
});

test('无水印、小图和破坏图片不得输出账号', () => {
  const rgba = new Uint8ClampedArray(100 * 100 * 4).fill(255);
  assert.equal(codec.decodeImage(rgba, 100, 100).detected, false);
  let state = 123456;
  const noise = new Uint8ClampedArray(720 * 1600 * 4);
  for (let i = 0; i < noise.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; noise[i] = state & 255; }
  assert.equal(codec.decodeImage(noise, 720, 1600, {fullSearch: false}).detected, false);
});

test('2/3与1/2缩放、外框、局部标注仍恢复完整载荷', () => {
  const vector = vectors.find(v => v.version === 7), source = synthetic(vector);
  for (const scale of [2 / 3, .5]) {
    const left=22, top=31, width=Math.round(source.width*scale)+44, height=Math.round(source.height*scale)+62;
    const rgba=new Uint8ClampedArray(width*height*4);rgba.fill(45);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4;rgba[p+3]=255;
      if(x<left||x>=width-left||y<top||y>=height-top)continue;
      // 区域均值模拟缩小；使用合成纹理，不包含真实媒体。
      const x0=Math.floor((x-left)/scale),x1=Math.min(source.width,Math.ceil((x-left+1)/scale));
      const y0=Math.floor((y-top)/scale),y1=Math.min(source.height,Math.ceil((y-top+1)/scale));
      for(let c=0;c<3;c++){let sum=0,n=0;for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){sum+=source.rgba[(yy*source.width+xx)*4+c];n++;}rgba[p+c]=Math.round(sum/n);}
      if(y>300&&y<320&&x>90&&x<Math.min(width-30,420)){rgba[p]=255;rgba[p+1]=20;rgba[p+2]=0;}
    }
    const value=codec.decodeImage(rgba,width,height,{timeoutMs:10000});
    assert.equal(value.detected,true,JSON.stringify(value));assert.equal(value.userId,vector.uid);
    assert.equal(value.diagnostics.payloadHex,vector.payload);
  }
});

test('半屏彩色背景：限幅回退保留完整载荷与原有观测门槛', () => {
  const vector = vectors.find(v => v.version === 7), tile=codec.makeTile(codec.fromHex(vector.payload));
  const width=1206,height=1467,rgba=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(y*width+x)*4,t=((y%512)*544+x%544)*4;
    const h=codec.hash(Math.floor(y/8)*53+Math.floor(x/32));
    // 页面颜色梯度先生成，再合成水印；少量强边缘不应支配重复观测。
    const gradient=h%3===0 ? 72*((x%32)/32-.5)*(h&1?1:-1) : 0;
    const background=[125+(y%200)/8+gradient,135+gradient,145-gradient];
    for(let c=0;c<3;c++)rgba[p+c]=Math.round(background[c]*251/255)+tile[t+c];
    rgba[p+3]=255;
  }
  const value=codec.decodeImage(rgba,width,height,{timeoutMs:10000,fullSearch:false});
  assert.equal(value.detected,true,JSON.stringify(value));
  assert.equal(value.userId,vector.uid);assert.equal(value.diagnostics.payloadHex,vector.payload);
  assert.ok(value.minObservations>=5);assert.match(value.crcStatus,/^OK/);
  assert.equal(value.diagnostics.contrastLimit,4);
});
