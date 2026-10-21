# GameHelper 水印检查器 · 纯 Web

[在线使用](https://honglang.online/watermark-inspector-web/) · [部署状态](https://github.com/gudujiucheng/watermark-inspector-web/actions/workflows/pages.yml)

直接访问在线页面即可解码，无需安装桌面工具。图片只在浏览器内处理，不上传到 GitHub 或其他服务器。

GHCV6 截图解码、剪贴板粘贴、实际像素色度增强、参考编码框和局部放大。全部计算在浏览器内完成，图片不上传。

## 分享与使用

构建产物只有一个自包含的 `dist/index.html`，不引用 CDN、字体、模型或外部脚本。接收方无需安装 Python、Node、FFmpeg 或桌面应用。

- **静态部署**：把 `dist/index.html` 放到任意静态站点即可，建议使用 HTTPS。没有 API、数据库或后端解码服务。
- **单文件分享**：直接发送 `dist/index.html`。设计支持本地浏览器打开；不同浏览器对 `file://`、Worker 和剪贴板权限的限制可能不同。如果浏览器拦截，请用静态 HTTPS 页面打开。
- 选择或拖入截图，也可以直接按 `⌘V` / `Ctrl+V` 粘贴图片。“粘贴图片”按钮依赖浏览器剪贴板权限，HTTPS / localhost 更适合使用。
- 支持 PNG、JPEG、WebP、BMP 等浏览器可读取的图片，最多 25 MB、1200 万像素。视频请先抽取单帧；本工程不包含视频抽帧器。
- 蓝框是重复数据块，橙色窄列是同步列。虚线框对应上方局部放大图，可点击区域或“换一个区域”切换。
- 可导出当前着色 PNG 和识别 JSON。所有数据只在当前页面内存中处理，刷新或“清空图片”后释放。

## 开发

仅开发、构建和自动测试需要 Node.js 18+；没有 npm 依赖，无需执行 `npm install`。

```sh
npm run build
npm test
npm run dev
```

`npm run dev` 只启动本机静态文件预览服务器，默认 `http://127.0.0.1:58700`。它只响应 GET/HEAD，不接收图片，不执行解码。访问者真正的解码任务在浏览器的 Blob Web Worker 中完成。

目录：

```text
src/codec.js           BCH/CRC、63位账号、同步和缩放盲搜索
src/worker.js          后台解码、进度反馈
src/local-analysis.js  本地图片读取、取消、参考图生成
src/app.js             图像增强、导出、交互
src/regions.js         粘贴、编码框、局部对照
src/index.html        页面结构
src/style.css         页面样式
scripts/build.mjs     零依赖单文件打包
scripts/serve.mjs     可选的静态预览
test/                 Python 协议向量及边界测试（不含真实用户媒体）
dist/index.html       可分享/部署的完整页面
```

## GitHub Pages 部署

仓库使用 GitHub Actions 自动部署：每次推送到 `main`，先运行协议测试，再构建 `dist/`，测试和构建通过后发布到 GitHub Pages。

- Pages 的构建来源为 **GitHub Actions**。
- 发布内容仅为 `dist/` 中的自包含 HTML 和上游许可文件。
- Actions 固定到已核对的提交 SHA；部署权限仅在部署任务中授予。
- 仓库不包含实际用户截图、日志、设备标识或访问令牌，测试向量使用合成数据。

## 协议与验证边界

- 与当前 Android GHCV6 色度纹理对应：544×512 tile，32×8 cell，16列数据 + 1列同步，BCH(511,211,t40) 加总体偶校验，CRC24。
- `note` 的 base37 数值承载 userId 高31位，低32位在原 uid 字段中；浏览器用 BigInt 拼接，并以十进制字符串输出，避免63位整数精度丢失。`buildTime` 位段在 GHCV6 中表示固定协议修订时间。
- 保留每个码字比特至少5个物理观测、载荷范围、保留位、BCH、CRC 和多载荷冲突拒答。失败、观测不足或60秒超时不输出账号。
- 实际像素增强含页面原有色彩和文字边缘；参考图是成功解码后按估计几何重建的示意，不能当成逐像素检出热图。
- CRC 是完整性校验，不是身份验签。图像被编辑后仍需结合业务证据判断。
- 不支持旧 GHW1 灰度水印或其他产品的水印；当前 Android 真实录屏仍不可靠，移植到 Web 不会恢复已被编码器擦除的信号。
- 本轮页面验收在静态 HTTP 预览完成；自动化浏览器不允许访问 `file://`，因此本地双击方式未进行浏览器实测。

算法移植自 `zylcold/BlindWatermark`，固定版本 `fa59d61a163b475512b475e1d1f99ccce1168426`。MIT 许可及版权声明保留于 `LICENSE.upstream`；生成 HTML 的源码注释同样包含上游版权与许可。
