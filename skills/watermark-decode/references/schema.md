# GHCV8 项目规则

规则文件是 UTF-8 JSON，只允许 `projectKey`（稳定的ASCII项目标识）、`schemaVersion`（1..65535）、按编码顺序排列的 `fields`。
每个字段为 `key` 与 `type`，并按类型设置参数：

| type | 参数与 JSON 值 |
|---|---|
| uint / int | bits=1..64，可选 min/max（大整数用十进制字符串）。超过53位的字段解码为字符串。 |
| bool | 固定1位，值为 true/false。 |
| enum | bits 与不重复的字符串数组 values，按数组索引编码。 |
| time | bits<=32、epoch（UTC秒）、stepSeconds=1..86400。输入输出均为绝对UTC秒，必须严格对齐。 |
| string | maxBytes=1..14，encoding 固定 utf-8；按字节限制，不按字符数；禁止非法Unicode。 |
| bytes | maxBytes=1..14，encoding 固定 hex；值为偶数长度十六进制字符串。 |

字符串/字节串先写 ceil(log2(maxBytes+1)) 位实际长度，再写固定 maxBytes 的字节槽，未用字节必须为0。
所有字段总计不得超过119位，缺字段、多字段、越界、超长一律拒绝，不截断。

归一化时补全类型默认值，字段顺序保持不变，对象键按JS UTF-16排序；只允许整数规则参数。规范化JSON不带空格、不转义普通Unicode。SHA-256前16个十六进制字符为64位指纹；它不是身份签名。历史规则必须保留，不能覆盖同版本规则来解释旧图片。

211位消息按低位先行排列：4位协议8、64位指纹整数、119位业务槽（剩余补0）、CRC24（覆盖前187位）。沿用BCH(511,211,t40)、总体偶校验、544×512纹理、同步与观测门槛。

项目根的 watermark.analysis.json 由上层日志流程读取，不参加指纹。当前映射键为 projectKey、schemaVersion、identityField、timeField、timeWindowSeconds、gameField、logRouting；不包含可执行命令或任意请求URL。日志入口仍使用调用方已有、已获授权的工具。
