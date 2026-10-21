// 编解码源码由构建脚本内联在前面，Worker 不加载任何远端脚本。
self.onmessage = event => {
  const {buffer, width, height} = event.data;
  let previous = 0;
  try {
    const result = WatermarkCodec.decodeImage(new Uint8ClampedArray(buffer), width, height, {
      timeoutMs: 60000,
      progress(stage) {
        const now = performance.now();
        if (now - previous > 100) { self.postMessage({type: 'progress', stage}); previous = now; }
      }
    });
    result.width = width;
    result.height = height;
    result.engine = 'browser-javascript-worker';
    self.postMessage({type: 'result', result});
  } catch (error) {
    self.postMessage({type: 'error', error: '图片处理失败，请重试或换一张图片'});
  }
};
