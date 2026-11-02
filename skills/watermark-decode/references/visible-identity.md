# 侧边明文兜底（当前AI会话读图）

每个异常区域先解隐形水印。失败、无水印或超时后，才尝试项目明确声明的侧边明文。完整载荷冲突必须先分区，不能用明文压掉冲突。正常对照的已校验身份不能替代异常主体。

## 准备与读数

```bash
watermark-decode prepare-visible screenshot.png --project /path/project --output /private/evidence/visible
# 拼图可加 --box 0 0 0.5 1（EXIF修正后的原图归一化坐标）
watermark-decode assess-visible --prepared /private/evidence/visible/prepared.json --observations-json '{"readings":[{"crop_id":"工具实际返回的side引用","text":"123456789","complete":true,"clear":true,"reason":"整段数字及首尾清晰可见，无明显截断"}]}'
```

`prepare-visible`只生成左右原像素、转正、最多3倍放大及对比度图片，不声称识别。保留每侧完整高度，黄金分割位置仅作查找提示，不能据此裁短搜索范围。使用当前AI会话查看工具返回的图片路径，分别判断每侧；不启动本地OCR或另开视觉会话。不能从文件名、屏幕其他普通数字或旧账号补读。

单侧整段清晰完整即可作为查询线索，无需每次向用户确认；两侧分别读取且完整一致为较高视觉置信。同图两侧只算一份证据。模糊、明显截断或冲突时不拼数字、不补猜；0是未登录。工具核对文件哈希、裁剪引用、数字格式、配置范围及两侧一致性，不能独立验证AI看到的字形，不称为完整性校验。

### 截图位置不固定时

先看原图和实际文字方向，不把整图左右边缘、黄金分割点或固定比例当作必要条件。留黑、裁剪、拼接后，原App侧边的文字可能出现在图片中间。默认裁剪没包含文字，不代表原图没有身份线索；可根据原图标出读取区域，通过现有`--box`或媒体角色`regions`重新准备，确保目标文字完整进入实际返回的裁剪图，再用它的`crop_id`提交观察，不能编造引用或拼补片段。工具的left/right表示所选读取区域的取样侧，不保证是整张图片的左右边缘。

方向只是查找提示，普通界面的竖向数字也可能相似；仍由当前AI结合项目定义、原图及异常/正常角色判断是否为账号。重复读取同一位置不能提高独立证据计数；一张图上多处相同文字仍只算一份媒体。不同清晰读数不强行选择，明文始终未经水印校验。

## 项目声明

项目的`watermark.analysis.json`在已有`projectKey`、`identityField`旁增加：

```json
{"visibleIdentity":{"enabled":true,"profile":"visible-edge-text-v1","sideWidthRatio":0.08,"maxValue":"9223372036854775807"}}
```

这是分析映射，不参与编码指纹。必须显式指定项目（或当前Git项目）/`--analysis`文件；多个项目关联不明确时拒绝套用。其他项目必须先确认布局和字段，不能默认所有侧边数字都是userId。明文只提供身份，不推导gameId、UTC或30秒区间；查询需独立的时间证据、项目字段映射和现有工具授权。本工具不自动查日志。

## auto-bug-fix接入

第一次执行上下文的`capture_identity_tool.command --roles-json ...`，返回`visible_preparations`。复用同一AI会话检查图片后，再执行同一命令及同一selection，追加：

```json
{"observations":[{"source_ref":"工具返回的source_ref","readings":[{"crop_id":"实际引用","text":"123456789","complete":true,"clear":true,"reason":"实际读图依据"}]}]}
```

作为`--visible-observations-json`内存参数。控制面核对来源并返回至多两个候选，保留异常/正常角色、相同媒体哈希及视频去重。不要编辑manifest、缓存或来源回执。缺依赖、来源变化、格式错误、冲突和预算不足应记录具体非阻塞提醒，继续原分析。每图隐形解码5秒，全部目标共享30秒像素处理预算；当前AI读图时间单独记录，不称为解码耗时。

报告来源区分“校验水印”和“AI读取侧边明文”，记录单/双侧置信、附件、帧真实PTS及区域/裁剪引用、选择依据和实际查询用途；公开报告隐藏原始账号。独立浏览器使用本地Tesseract OCR，显示“单处OCR候选/多处OCR一致”，与本Skill的AI判断不同，均未经水印校验。
