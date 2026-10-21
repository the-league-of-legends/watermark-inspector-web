/**
 * GHCV6/7 纯 JavaScript 编解码。移植自 zylcold/BlindWatermark (MIT)
 * fa59d61a163b475512b475e1d1f99ccce1168426；许可见 LICENSE.upstream。
 * 数组位序、纠错、同步搜索与 Python 镜像一致，不依赖服务器或模型。
 */
const WatermarkCodec = (() => {
  'use strict';
  const EPOCH = 1767225600, ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  const WIDTH = 544, HEIGHT = 512, ROWS = 64, COLS = 17, DATA_COLS = 16;
  const MIN_OBS = 5, MIN_PILOT = .35, MAX_CONTEXTS = 12;
  const generator = BigInt('0x1afacb7265f767a72b944cd8262f8e5da4fc52abda8671e54039803464e5c000fede5061fc03');
  const generatorBits = Array.from({length: 301}, (_, i) => Number(generator >> BigInt(i) & 1n));
  const EXP = new Uint16Array(1022), LOG = new Int16Array(512).fill(-1);
  let fieldValue = 1;
  for (let i = 0; i < 511; i++) {
    EXP[i] = fieldValue; LOG[fieldValue] = i; fieldValue <<= 1;
    if (fieldValue & 0x200) fieldValue ^= 0x211;
  }
  for (let i = 511; i < 1022; i++) EXP[i] = EXP[i - 511];
  const multiply = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
  const exp = n => EXP[((n % 511) + 511) % 511];
  const inverse = n => exp(511 - LOG[n]);
  const modulo = (n, m) => ((n % m) + m) % m;
  const hash = n => {
    let value = (Math.imul(n, 0x9e3779b9) + 0x7f4a7c15) >>> 0;
    value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0;
    return (value ^ value >>> 13) >>> 0;
  };
  const pilotSet = new Set(Array.from({length: 64}, (_, i) => i).sort((a, b) => hash(a) - hash(b)).slice(0, 32));
  const pilots = Array.from({length: 64}, (_, i) => pilotSet.has(i));
  const signs = pilots.map(value => value ? -1 : 1);
  const indices = Array.from({length: 1024}, (_, i) => i < 512 ? (i * 73 + 19) & 511 : ((i - 512) * 151 + 89) & 511);
  const polarities = indices.map((_, i) => hash(i) & 1 ? -1 : 1);
  const pilotObserved = Array.from({length: 1088}, (_, i) => {
    const dx = i % COLS, dy = Math.floor(i / COLS);
    return Uint16Array.from({length: ROWS}, (_, row) => modulo(row - dy, ROWS) * COLS + modulo(16 - dx, COLS));
  });
  const unpack = (bytes, count) => Uint8Array.from({length: count}, (_, i) => (bytes[i >> 3] >> (i & 7)) & 1);
  function pack(bits) {
    const bytes = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
    return bytes;
  }
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = value => Uint8Array.from(value.match(/../g) || [], b => parseInt(b, 16));
  function crc24(bits) {
    let crc = 0xb704ce;
    for (const bit of bits) {
      const top = (crc >>> 23) ^ bit; crc = (crc << 1) & 0xffffff;
      if (top) crc ^= 0x864cfb;
    }
    return crc;
  }
  function radixText(value, length) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 37 ** length) return null;
    let text = '';
    for (let i = 0; i < length; i++) { text = ALPHABET[value % 37] + text; value = Math.floor(value / 37); }
    return text.replace(/_+$/, '');
  }
  function readPayload(bytes) {
    if (bytes.length !== 27 || bytes[26] & 0xf8) return null;
    const bits = unpack(bytes, 211); let cursor = 0;
    function read(width) {
      let value = 0;
      for (let i = 0; i < width; i++) value += bits[cursor++] * 2 ** i;
      return value;
    }
    const version = read(4);
    if (version !== 6 && version !== 7) return null;
    const lowUid = read(32), timestamp = EPOCH + read(31), revision = EPOCH + read(24) * 60;
    const pageBits = read(42);
    if (version === 7 && pageBits !== 0) return null;
    const legacyPage = version === 6 ? radixText(pageBits, 8) : null;
    const game = read(version === 6 ? 14 : 16), upper = read(32), crc = read(24), reserved = read(version === 6 ? 8 : 6);
    if ((version === 6 && legacyPage === null) || game > (version === 6 ? 9999 : 65535) || upper >= 37 ** 6 || reserved || crc24(bits.slice(0, version === 6 ? 179 : 181)) !== crc) return null;
    // GHCV6 的 note 数值承载 userId 高31位；不能用 JS Number 拼接63位账号。
    if (upper > 0x7fffffff || timestamp % 30) return null;
    const uid = (BigInt(upper) << 32n) | BigInt(lowUid);
    return {protocol: `GHCV${version}`, userId: uid ? uid.toString() : null, loggedIn: uid !== 0n,
      gameId: game, timeStartUtc: timestamp, timeEndUtc: timestamp + 29,
      protocolRevisionTimeUtc: revision, payloadHex: hex(bytes)};
  }
  function bchEncode(message) {
    if (message.length !== 27 || message[26] & 0xf8) throw Error('Invalid BCH message');
    const bits = unpack(message, 211), work = new Uint8Array(511), word = new Uint8Array(512);
    work.set(bits, 300); word.set(bits, 300);
    for (let pivot = 510; pivot >= 300; pivot--) {
      if (!work[pivot]) continue;
      for (let j = 0; j <= 300; j++) work[pivot - 300 + j] ^= generatorBits[j];
    }
    word.set(work.slice(0, 300));
    for (let i = 0; i < 511; i++) word[511] ^= word[i];
    return pack(word);
  }
  function syndromes(bits) {
    const values = new Uint16Array(80);
    for (let degree = 0; degree < 511; degree++) {
      if (!bits[degree]) continue;
      for (let order = 1; order <= 80; order++) values[order - 1] ^= exp(order * degree);
    }
    return values;
  }
  function berlekampMassey(values) {
    let connection = new Uint16Array(81), backup = new Uint16Array(81);
    connection[0] = backup[0] = 1;
    let length = 0, shift = 1, scale = 1;
    for (let index = 0; index < 80; index++) {
      let discrepancy = values[index];
      for (let coefficient = 1; coefficient <= length; coefficient++) discrepancy ^= multiply(connection[coefficient], values[index - coefficient]);
      if (!discrepancy) { shift++; continue; }
      const previous = connection.slice(), factor = multiply(discrepancy, inverse(scale));
      for (let coefficient = 0; coefficient < 81 - shift; coefficient++) connection[coefficient + shift] ^= multiply(factor, backup[coefficient]);
      if (2 * length <= index) {
        length = index + 1 - length; backup = previous; scale = discrepancy; shift = 1;
      } else shift++;
      if (length > 40) return null;
    }
    return connection.slice(0, length + 1);
  }
  function bchDecode(data) {
    if (data.length !== 64) return null;
    const received = unpack(data, 512), corrected = received.slice(0, 511), values = syndromes(corrected);
    let correctedCount = 0;
    if (values.some(Boolean)) {
      const locator = berlekampMassey(values);
      if (!locator || locator.length <= 1 || locator.length > 41) return null;
      const positions = [];
      for (let degree = 0; degree < 511; degree++) {
        const x = degree === 0 ? 1 : exp(511 - degree); let value = 0, power = 1;
        for (const coefficient of locator) { value ^= multiply(coefficient, power); power = multiply(power, x); }
        if (!value) positions.push(degree);
      }
      if (positions.length !== locator.length - 1) return null;
      for (const position of positions) corrected[position] ^= 1;
      if (syndromes(corrected).some(Boolean)) return null;
      correctedCount = positions.length;
    }
    let parity = 0;
    for (const bit of corrected) parity ^= bit;
    correctedCount += received[511] !== parity ? 1 : 0;
    const full = new Uint8Array(512); full.set(corrected); full[511] = parity;
    const message = pack(corrected.slice(300)), codeword = pack(full), canonical = bchEncode(message);
    if (canonical.some((value, i) => value !== codeword[i])) return null;
    return {message, codeword, correctedCount};
  }
  function makeTile(payloadBytes) {
    const word = bchEncode(payloadBytes), pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      let negative = pilots[row];
      if (col < DATA_COLS) {
        const position = row * DATA_COLS + col, index = indices[position];
        negative = !!(((word[index >> 3] >> (index & 7)) & 1) ^ (hash(position) & 1));
      }
      for (let x = 0; x < 32; x++) {
        const wave = Math.sin(2 * Math.PI * (x + .5) / 32), yellow = (1 - (negative ? -wave : wave)) / 2;
        const red = Math.floor(yellow + .5), blue = Math.floor(4 * (1 - yellow) + .5);
        for (let y = 0; y < 8; y++) pixels.set([red, red, blue, 4], ((row * 8 + y) * WIDTH + col * 32 + x) * 4);
      }
    }
    return pixels;
  }
  function evidenceBounds(data, width, height) {
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      const first = y * width * 4;
      for (let x = 1; x < width; x++) {
        const p = first + x * 4;
        if (data[p] !== data[first] || data[p + 1] !== data[first + 1] || data[p + 2] !== data[first + 2]) { top = Math.min(top, y); bottom = y; break; }
      }
    }
    for (let x = 0; x < width; x++) {
      const first = x * 4;
      for (let y = 1; y < height; y++) {
        const p = (y * width + x) * 4;
        if (data[p] !== data[first] || data[p + 1] !== data[first + 1] || data[p + 2] !== data[first + 2]) { left = Math.min(left, x); right = x; break; }
      }
    }
    return right >= left && bottom >= top ? [left, top, right + 1, bottom + 1] : [0, 0, 0, 0];
  }
  function integralImage(data, width, height, companion) {
    const stride = width + 1, sat = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4, rg = (data[p] + data[p + 1]) / 2;
        rowSum += companion ? -rg : data[p + 2] - rg;
        sat[(y + 1) * stride + x + 1] = rowSum + sat[y * stride + x + 1];
      }
    }
    return {values: sat, width, height, stride};
  }
  function at(sat, x, y) {
    x = Math.max(0, Math.min(sat.width, x)); y = Math.max(0, Math.min(sat.height, y));
    const ix = Math.floor(x), iy = Math.floor(y), nx = Math.min(ix + 1, sat.width), ny = Math.min(iy + 1, sat.height);
    const fx = x - ix, fy = y - iy, s = sat.values, stride = sat.stride;
    return (s[iy * stride + ix] * (1 - fx) + s[iy * stride + nx] * fx) * (1 - fy)
      + (s[ny * stride + ix] * (1 - fx) + s[ny * stride + nx] * fx) * fy;
  }
  function accumulate(sat, scale, x, y, bounds, companion) {
    const cw = 32 * scale, ch = 8 * scale;
    if (sat.width - x < cw || sat.height - y < ch || x < 0 || y < 0) return null;
    const nx = Math.floor((sat.width - x) / cw), ny = Math.floor((sat.height - y) / ch);
    const sums = new Float64Array(1088), squares = new Float64Array(1088), counts = new Float64Array(1088), evidence = new Float64Array(1088);
    const [left, top, right, bottom] = bounds, area = cw / 2 * ch;
    for (let row = 0; row < ny; row++) for (let col = 0; col < nx; col++) {
      const px = x + col * cw, py = y + row * ch, mid = px + cw / 2, end = px + cw;
      const a = (at(sat, mid, py + ch) - at(sat, px, py + ch) - at(sat, mid, py) + at(sat, px, py)) / area;
      const b = (at(sat, end, py + ch) - at(sat, mid, py + ch) - at(sat, end, py) + at(sat, mid, py)) / area;
      const d = Math.max(-12, Math.min(12, a - b)), id = (row % ROWS) * COLS + col % COLS;
      const valid = px >= left && py >= top && px + cw <= right && py + ch <= bottom;
      if (valid) evidence[id]++;
      if (companion && !valid) continue;
      sums[id] += d; squares[id] += d * d; counts[id]++;
    }
    return {sums, squares, counts, evidence};
  }
  function context(sat, geometry, bounds, companion) {
    const {scale, x, y} = geometry, stats = accumulate(sat, scale, x, y, bounds, companion);
    if (!stats) return null;
    const means = stats.sums.map((value, i) => stats.counts[i] ? value / stats.counts[i] : 0);
    const shifts = [];
    for (let i = 0; i < 1088; i++) {
      let dot = 0, energy = 0;
      const observed = pilotObserved[i];
      for (let row = 0; row < 64; row++) { const value = means[observed[row]]; dot += value * signs[row]; energy += value * value; }
      shifts.push({x: i % COLS, y: Math.floor(i / COLS), pilot: energy > 0 ? dot / Math.sqrt(energy * 64) : 0});
    }
    shifts.sort((a, b) => b.pilot - a.pilot);
    return {stats, scale, x, y, companion, shifts: shifts.slice(0, 2), score: shifts[0].pilot};
  }
  function softScores(ctx, shift) {
    const n = new Float64Array(512), folded = new Float64Array(512), squared = new Float64Array(512), counts = new Float64Array(512);
    const {sums, squares, counts: observations, evidence} = ctx.stats;
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < DATA_COLS; col++) {
      const position = row * DATA_COLS + col, local = modulo(row - shift.y, ROWS) * COLS + modulo(col - shift.x, COLS), bit = indices[position];
      n[bit] += observations[local]; folded[bit] += sums[local] * polarities[position];
      squared[bit] += squares[local]; counts[bit] += evidence[local];
    }
    const scores = folded.map((value, bit) => {
      const mean = n[bit] ? value / n[bit] : 0;
      const variance = Math.max(.25, (n[bit] ? squared[bit] / n[bit] : 0) - mean * mean);
      return mean * Math.sqrt(n[bit] / variance);
    });
    return {ctx, shift, scores, counts};
  }
  function attempt(pending, flips = []) {
    const {scores, counts, ctx, shift} = pending, hard = Uint8Array.from(scores, value => value < 0 ? 1 : 0), bits = hard.slice();
    for (const bit of flips) bits[bit] ^= 1;
    const corrected = bchDecode(pack(bits));
    if (!corrected) return null;
    const payload = readPayload(corrected.message);
    if (!payload) return null;
    const canonical = unpack(corrected.codeword, 512);
    let changed = 0, minObs = Infinity, sumObs = 0;
    for (let i = 0; i < 512; i++) { changed += hard[i] !== canonical[i] ? 1 : 0; minObs = Math.min(minObs, counts[i]); sumObs += counts[i]; }
    const magnitude = Array.from(scores, Math.abs).sort((a, b) => a - b);
    return {payload, correctedBits: changed, minObs, avgObs: sumObs / 512, medianZ: (magnitude[255] + magnitude[256]) / 2, ctx, shift};
  }
  function candidates(contexts, check) {
    const found = [], pending = [];
    for (const ctx of contexts) for (const shift of ctx.shifts) {
      check();
      if (shift.pilot < MIN_PILOT) continue;
      const soft = softScores(ctx, shift), hit = attempt(soft);
      if (hit) found.push(hit); else pending.push(soft);
    }
    if (found.length) return found;
    pending.sort((a, b) => b.shift.pilot - a.shift.pilot);
    for (const item of pending.slice(0, 2)) {
      const ranked = Array.from({length: 512}, (_, i) => i).sort((a, b) => Math.abs(item.scores[a]) - Math.abs(item.scores[b])).slice(0, 6);
      for (let a = 0; a < ranked.length; a++) {
        check(); const single = attempt(item, [ranked[a]]); if (single) found.push(single);
        for (let b = a + 1; b < ranked.length; b++) { const hit = attempt(item, [ranked[a], ranked[b]]); if (hit) found.push(hit); }
      }
    }
    return found;
  }
  function adjudicate(found) {
    if (!found.length) return null;
    found.sort((a, b) => b.minObs - a.minObs || b.medianZ - a.medianZ || b.shift.pilot - a.shift.pilot);
    const distinct = new Set(found.map(item => item.payload.payloadHex));
    return {best: found[0], ambiguous: distinct.size > 1, candidateCount: distinct.size};
  }
  function search(sat, bounds, companion, scales, check) {
    function scan(values) {
      const found = [];
      for (const scale of values) {
        check(); if (!Number.isFinite(scale) || scale < .5 || scale > 1.5) continue;
        let best = null;
        for (let y = 0; y < 8 * scale; y += 2) for (let x = 0; x < 32 * scale; x += 4) {
          check(); const ctx = context(sat, {scale, x, y}, bounds, companion);
          if (ctx && (!best || ctx.score > best.score)) best = ctx;
        }
        if (best) found.push(best);
      }
      return found.sort((a, b) => b.score - a.score);
    }
    function finish(contexts) {
      const refined = [], dxs = companion ? [-2, -1, 0, 1, 2] : [-2, 0, 2], dys = companion ? [-1, -.5, 0, .5, 1] : [-1, 0, 1];
      for (const seed of contexts.slice(0, MAX_CONTEXTS)) for (const dy of dys) for (const dx of dxs) {
        check(); let x = seed.x + dx, y = seed.y + dy;
        if (companion) { x = modulo(x, 32 * seed.scale); y = modulo(y, 8 * seed.scale); }
        if (x < 0 || y < 0) continue;
        const ctx = context(sat, {scale: seed.scale, x, y}, bounds, companion);
        if (ctx) refined.push(ctx);
      }
      refined.sort((a, b) => b.score - a.score);
      return adjudicate(candidates(refined.slice(0, MAX_CONTEXTS), check));
    }
    if (scales) return finish(scan(scales));
    const exact = finish(scan([1])); if (exact) return exact;
    const coarse = scan(Array.from({length: 21}, (_, i) => .5 + i * .05)), fine = new Set(), step = 1 / Math.max(sat.width, sat.height);
    for (const seed of coarse.slice(0, 3)) {
      for (let value = Math.max(.5, seed.scale - .03); value <= Math.min(1.5, seed.scale + .03) + 1e-10; value += step) fine.add(Math.floor(value * 1e6 + .5) / 1e6);
    }
    return finish(scan(Array.from(fine).sort((a, b) => a - b)));
  }
  function decodeBest(data, width, height, bounds, scales, check, progress) {
    for (const companion of [false, true]) {
      progress(companion ? '检查伴色色度通道' : '同步定位与纠错校验');
      const sat = integralImage(data, width, height, companion), result = search(sat, bounds, companion, scales, check);
      if (result) return result;
    }
    return null;
  }
  function decodeImage(rgba, width, height, options = {}) {
    const started = performance.now(), deadline = started + (options.timeoutMs || 60000);
    const check = () => { if (performance.now() >= deadline) throw Error('decode_timeout'); };
    const progress = options.progress || (() => {});
    const failure = reason => ({detected: false, reason, elapsedMs: Math.round(performance.now() - started)});
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 12000000 || rgba.length !== width * height * 4) return failure('invalid_image');
    try {
      const bounds = evidenceBounds(rgba, width, height);
      let result = decodeBest(rgba, width, height, bounds, [1.5, 1.125, .75, 1], check, progress);
      if (!result && options.fullSearch !== false) result = decodeBest(rgba, width, height, bounds, null, check, progress);
      if (!result) return failure('no_unambiguous_valid_payload_or_insufficient_observations');
      if (result.ambiguous) return failure('conflicting_payloads');
      const best = result.best;
      if (best.minObs < MIN_OBS) return failure('insufficient_observations');
      const {payloadHex, ...payload} = best.payload;
      return {detected: true, ...payload, correctedBits: best.correctedBits,
        minObservations: best.minObs, elapsedMs: Math.round(performance.now() - started),
        crcStatus: 'OK (integrity only; not authenticated)',
        diagnostics: {payloadHex, scale: best.ctx.scale, cellPhaseX: best.ctx.x, cellPhaseY: best.ctx.y,
          tileShiftCellsX: best.shift.x, tileShiftCellsY: best.shift.y,
          companionRecovery: best.ctx.companion, pilotScore: best.shift.pilot}};
    } catch (error) {
      if (error.message === 'decode_timeout') return failure('decode_timeout');
      throw error;
    }
  }
  return {decodeImage, bchEncode, bchDecode, readPayload, makeTile, hex, fromHex, hash, evidenceBounds, WIDTH, HEIGHT};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WatermarkCodec;
