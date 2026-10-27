# GameHelper 水印检查器 · 纯 Web

[在线使用](https://the-league-of-legends.github.io/watermark-inspector-web/) · [部署状态](https://github.com/the-league-of-legends/watermark-inspector-web/actions/workflows/pages.yml)

直接访问在线页面即可解码，无需安装桌面工具。图片只在浏览器内处理，不上传到 GitHub 或其他服务器。

GHCV6/7/8 图片解码、剪贴板粘贴，以及重复水印区域的数量和位置估算。全部计算在浏览器内完成，图片不上传。

## 分享与使用

构建产物只有一个自包含的 `dist/index.html`，不引用 CDN、字体、模型或外部脚本。接收方无需安装 Python、Node、FFmpeg 或桌面应用。

- **静态部署**：把 `dist/index.html` 放到任意静态站点即可，建议使用 HTTPS。没有 API、数据库或后端解码服务。
- **单文件分享**：直接发送 `dist/index.html`。设计支持本地浏览器打开；不同浏览器对 `file://`、Worker 和剪贴板权限的限制可能不同。如果浏览器拦截，请用静态 HTTPS 页面打开。
- 选择或拖入截图，也可以直接按 `⌘V` / `Ctrl+V` 粘贴图片。“粘贴图片”按钮依赖浏览器剪贴板权限，HTTPS / localhost 更适合使用。
- 支持 PNG、JPEG、WebP、BMP 等浏览器可读取的图片，最多 25 MB、1200 万像素。视频请先抽取单帧；本工程不包含视频抽帧器。
- 载荷结果只显示完整 JSON，并提供复制按钮，不再重复平铺字段。没有项目专用中文标签，不把布尔值转为“是／否”，不自动转换时间戳；嵌套对象和数组完整保留在 JSON 中，字符串与长账号保持原值和类型。业务 JSON 不混入解码耗时、区域估算等工具元信息；完整工具结果仍可通过原有识别 JSON 导出。
- 默认原图展示编号位置框：实线为完整尺寸区域，虚线为边缘残片，紫色外线为内容边界估计的参考范围。点击框或区域列表可联动高亮；区域列表在窄屏默认收起。
- 数量按整图成功解码后的纹理排列推算，并非逐区独立校验；完整尺寸只描述几何范围，不表示单块能独立解码。未识别时数量和位置均无法确认，不显示“0个水印”。
- “技术详情”默认折叠，保留双栏增强、同步列、局部放大及参考纹理。
- 可导出位置标注 PNG 和识别 JSON。JSON 的 `regionLayout` 包含估算口径、参考范围、完整／残片数量及每区的 `tileRect` / `visibleRect`，原有解码字段保留。所有数据只在当前页面内存中处理，刷新或“清空图片”后释放。

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
src/regions.js         粘贴、编号定位、区域列表与技术对照
src/region-layout.js   仅展示层的重复区域几何估算（不逐区验证）
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

- 兼容 GHCV6/7，并支持项目规则驱动的 GHCV8 色度纹理：544×512 tile，32×8 cell，16列数据 + 1列同步，BCH(511,211,t40) 加总体偶校验，CRC24。
- GHCV7 记录当前子游戏 ID（16位，0～65535），不采集页面，原页面字段42位固定为零并校验。GHCV6 旧截图仍可解码，游戏字段明确标为旧版主游戏 ID，不推测其子游戏。
- `note` 的 base37 数值承载 userId 高31位，低32位在原 uid 字段中；浏览器用 BigInt 拼接，并以十进制字符串输出，避免63位整数精度丢失。`buildTime` 位段在 GHCV6 中表示固定协议修订时间。
- 保留每个码字比特至少5个物理观测、载荷范围、保留位、BCH、CRC 和多载荷冲突拒答。失败、观测不足或60秒超时不输出账号。
- 实际像素增强含页面原有色彩和文字边缘；参考图是成功解码后按估计几何重建的示意，不能当成逐像素检出热图。
- CRC 是完整性校验，不是身份验签。图像被编辑后仍需结合业务证据判断。
- 不支持旧 GHW1 灰度水印或其他产品的水印；当前 Android 真实录屏仍不可靠，移植到 Web 不会恢复已被编码器擦除的信号。
- 本轮页面验收在静态 HTTP 预览完成；自动化浏览器不允许访问 `file://`，因此本地双击方式未进行浏览器实测。

算法移植自 `zylcold/BlindWatermark`，固定版本 `fa59d61a163b475512b475e1d1f99ccce1168426`。MIT 许可及版权声明保留于 `LICENSE.upstream`；生成 HTML 的源码注释同样包含上游版权与许可。

## GHCV8：项目携带规则，Skill独立使用

- 根目录 `watermark.schema.json` 是当前项目的规则；`watermark.analysis.json` 只供上层日志流程解释身份/时间，不参与编码。历史规则放入项目 `watermark.schemas/*.json`。
- GHCV8 使用4位协议、64位规则指纹、119位业务槽、24位CRC；沿用原BCH、观测门槛与纹理强度。字段名不写进图片。未知规则只确认水印校验，不输出业务字段。
- Web 点击“载入项目规则”选择当前/历史JSON，图片仍本地处理，无规则中心。只在匹配指纹后显示业务JSON，不为旧协议猜项目归属。
- 独立Skill源码位于 `skills/watermark-decode`；分发前运行 `npm run sync:skill`，将 `src/codec.js` 和 `src/schema.js` 按原字节打包。安装Skill后运行 `scripts/install.py` 创建独立Python环境和 `watermark-decode` 命令。Node18+与Pillow必需；不需要OpenCV/NumPy。
- 示例：`watermark-decode decode-image screenshot.png --rules /path/watermark.schema.json`；也可用 `--project /path/project`。规则规范见 Skill 的 `references/schema.md`。
- 示例第二业务规则为 `examples/other-project.schema.json`，字段与GameHelper不同，含枚举、布尔和UTF-8短字符串。容量按字节和位校验，超出拒绝，不能塞任意长JSON。
- 两端常量和测试向量通过 `node scripts/generate-native.mjs watermark.schema.json output-dir` 生成。当前GameHelper原生业务绑定固定为userId63、gameId16、capturedAt26；改变该绑定形状需显式修改原生业务取值，不允许静默截断。其他项目可使用通用JS编码接口与生成的位定义接入。
- 显式同步各仓库：`node scripts/sync-consumers.mjs --android /path/android --ios /path/ios --bugfix /path/ai-auto-bugfix`。不传目标不会扫描或写入其他工程。命令只同步水印规则和生成资源。
- 字节/位低位先行、归一化与指纹算法详见 `skills/watermark-decode/references/schema.md`；规则指纹不是身份签名。源规则变更必须升版本，保留历史规则与跨语言向量。
