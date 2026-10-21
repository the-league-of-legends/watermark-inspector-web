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
