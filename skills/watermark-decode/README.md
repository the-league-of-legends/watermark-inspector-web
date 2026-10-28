# 诊断水印解码与规则恢复

从截图或原始录屏单帧恢复完整载荷 JSON。GHCV8 按图片携带的规则指纹匹配项目定义，字段名由业务自己决定；兼容 GHCV6/7。只提取信息，不自动查日志或修复 Bug。

## 安装与图片解码

Python 3.10+、Node.js 18+。安装脚本建立独立虚拟环境、安装 Pillow，并生成 `~/.local/bin/watermark-decode`，不修改系统 Python：

```sh
python3 skills/watermark-decode/scripts/install.py
~/.local/bin/watermark-decode doctor
~/.local/bin/watermark-decode decode-image /path/screenshot.png --rules /path/watermark.schema.json
~/.local/bin/watermark-decode decode-image /path/screenshot.png --project /path/project
```

也可用独立环境的 Python 直接调用 `scripts/watermark_decode.py`。`--rules` 可重复；`--project` 读取工程根目录规则及 `watermark.schemas/*.json` 历史规则。不扫描其他仓库。默认5秒，`--timeout` 范围0.01–60秒；拼图可用 `--box left top right bottom` 指定归一化区域。

Agent 用法：“使用 watermark-decode，按这个工程的规则读取图片信息。”只在 `status=decoded` 时使用 payload；长整数保留字符串。缺规则返回 `unknown_schema`，保留指纹，不能按其他项目字段猜测；BCH／CRC失败或超时不给残缺账号。错误可明确提醒，集成流程继续原有取证。

## 从项目生成规则

Agent 用法：“使用 watermark-decode，读取这个工程的实际编码实现，自动恢复对应规则文件。”Skill 读取位布局与来源常量；工具校验指纹、容量及已有测试向量，不是通用反编译器。

```sh
watermark-decode generate-rules --project /path/project \
  --source /path/project/generated/vectors.json \
  --verify-source /path/project/EncoderSchema.java \
  --output /path/project/watermark.schema.json
```

缺少可核对指纹时只返回候选，不写正式文件；已有不同内容的目标文件拒绝覆盖。完整流程见 [规则恢复](references/generate-rules.md)，字段格式见 [规则规范](references/schema.md)。GHCV6/7不携带规则指纹，不能给旧图补一份GHCV8规则来匹配。

## 为新业务接入写入端

请读 [算法参考与接入指南](references/algorithm-integration.md)。包含容量和位序、BCH／CRC、纹理绘制、生命周期、内部包开关、示例和跨平台验证方法。可运行示例位于 [examples](examples/)：

```sh
node skills/watermark-decode/examples/encode-demo.cjs /tmp/watermark-demo
```

它生成纯合成的消息、码字、纹理 PNG 和测试截图，无需真实账号；随后按示例规则解码。示例证明算法接口可用，不代表你的业务页面、聊天压缩或真机截图已经通过。

## 视频与证据来源

本工具入口接收图片／单帧，不直接遍历视频。TAPD分析时主动联动 `bugfix-local-evidence video --original-png --count 12`，从清单读取原分辨率PNG和实际帧时间，逐帧解码。每张图最多5秒、每条Bug共享30秒解码预算；失败提醒但不阻断。完整角色判断、候选选择和智研／蓝鲸日志来源要求见 [TAPD流程](references/tapd-workflow.md)。默认缩放JPEG供人阅读，不应替代水印原始输入。

报告应写明图片或抽帧来源、帧时间、完整校验状态及身份是否用于后续查询。CRC仅检错，不是签名；不得从OCR、文件名、已知账号补猜失败结果。所有媒体在本机处理。

## 边缘解码更新

自动利用边缘定位头加速未知比例的正文搜索，兼容正文与边缘独立解码；详见[限制与失败处理](references/edge-decoding.md)。不保证单侧裁图可读，失败结果包含具体warning并继续原流程。
