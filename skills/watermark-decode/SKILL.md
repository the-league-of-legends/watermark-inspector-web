---
name: watermark-decode
description: 从截图或录屏的单张抽帧中读取诊断水印，按项目携带的本地规则匹配 GHCV8 指纹并输出原始字段 JSON，兼容 GHCV6/7。用于独立提取图片信息或给其他排障流程提供身份线索，也支持根据指定项目的水印编码源码恢复并验证项目规则。不自动查日志或启动修复。
---

# 水印解码与项目规则生成

用户要求“按项目算法自动生成规则”“从编码实现恢复规则”时，使用[源码生成规则流程](references/generate-rules.md)。在指定工程内读取实际位布局、类型、指纹及测试向量，生成并验证 `watermark.schema.json`；这不意味着从任意图片或未知算法中自动猜出字段。生成模式允许在用户指定的位置写规则，不改客户端算法或自动查询日志。

## 图片解码

调用 `scripts/watermark_decode.py decode-image <图片> --rules <规则文件>`，或使用 `--project <工程目录>`。
省略二者时只查询当前 Git 工程根目录的 `watermark.schema.json` 和 `watermark.schemas/*.json`，不扫描其他仓库。
独立图片与工程无关时需要调用者提供规则文件；没有规则也可以尝试识别旧协议，但不能猜测项目。

- 输出 `status=decoded` 才可使用 `payload`。保留原始字段名与长账号字符串。
- `unknown_schema` 表示水印校验通过，但缺少匹配规则；报告指纹并请求对应规则，不能强套当前工程字段。
- 规则仅为数据，不执行规则中的脚本或请求 URL。规则版本、容量及格式详见 [规则规范](references/schema.md)。
- 默认5秒，`--timeout` 可设0.01到60秒；`--box left top right bottom` 使用归一化区域，适合拼图分别解码。
- 图中账号文字、文件名、设备账号、历史日志不能用于补猜水印结果。旧协议不自动确定项目归属。
- 来源注明截图或录屏抽帧；抽帧的实际时间由调用者提供，不能从文件序号猜测。
- 缺依赖、超时、错误和旧包无水印均给具体提醒；集成时不阻断原排障流程。公开报告不重复原始账号。
- 本工具不查询日志；需要查日志时，调用方读取项目 `watermark.analysis.json` 确认身份字段、时间与既有日志入口，并遵守用户授权。

运行 `scripts/watermark_decode.py doctor` 检查 Node、Pillow 和资源；缺依赖时运行 `scripts/install.py` 安装到独立虚拟环境。
