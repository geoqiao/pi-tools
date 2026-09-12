# Pi Usage

[![npm version](https://img.shields.io/npm/v/@geoqiao/pi-usage)](https://www.npmjs.com/package/@geoqiao/pi-usage)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022.15-417e38)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

**这段时间用了多少 Token，主要用在哪？把 AI 编程工具的使用记录，变成一份本地交互报告。**

`@geoqiao/pi-usage` 支持 Pi、Claude Code、Codex 等 **28 类数据源**，在本机完成计价和分析，生成可离线打开的 HTML 看板，并导出 CSV / JSON。无需额外注册账号，无后台服务、LLM 分析调用或运行时 npm 依赖；**不上传统计数据**。

![Pi Usage 看板：日期与多维筛选、Token 构成、每日趋势、请求构成、用量排名和典型一天](https://raw.githubusercontent.com/geoqiao/pi-tools/main/packages/pi-usage/docs/media/pi-usage-dashboard.png)

> 看板截图。金额按本地价格表估算，不是实际账单；报告是生成时的快照，不会自动更新。

[快速开始](#快速开始) · [看板与分析](#看板与分析) · [命令行](#命令行) · [数据源与隐私](#数据源与隐私) · [计价口径](#计价口径)

## 快速开始

需要 **Node.js ≥ 22.15**。可作为 Pi 扩展使用，也可独立运行 CLI。

### 在 Pi 中使用

```bash
pi install npm:@geoqiao/pi-usage
```

已打开的 Pi 先执行 `/reload`。默认分析最近 90 天，也可指定天数：

```text
/usage-report
/usage-report 30
```

报告路径显示在 Pi UI 中，统计结果不会注入对话，也不会触发模型回合。生成在独立 Node 子进程中执行；退出或重载 Pi 会取消该进程。

### 独立运行

无需安装 Pi：

```bash
npx @geoqiao/pi-usage --days 90
```

命令完成后显示 `index.html` 的本地路径，双击即可打开，**不需要 Web 服务器**。默认报告目录为：

```text
~/.pi/usage/reports/report-<随机后缀>/
```

每次生成独立快照，不覆盖旧报告。完全禁止来源网络请求时使用 `--offline`；它不影响 `npx` 首次从 npm 下载包。

## 看板与分析

四个视图共用筛选条件。可组合日期、Harness、模型、项目、终端和请求类型，也可点击图表下钻，逐项移除筛选或一键重置。

| 视图 | 回答的问题 | 主要功能 |
|---|---|---|
| 看板 | 用了多少，用在哪，Code Mode 可能影响多少成本？ | 三层：整体用量与每日趋势；Harness / 含工具响应 / 模型分布与典型一天；Code Mode 成本影响，诊断证据按需展开 |
| 日分布 | 平常一天与高用量日差多少？ | 优先展示典型值、常见区间与高用量日；完整 Min / P25 / P50 / P75 / P90 / Max 和每日明细可展开 |
| 模型计价 | 同样的每日用量，换一套模型费率是多少？ | 逐日重新计价、分位与极值对比；默认按 P50 排序，可切换 P90 / Min / Max |
| 明细 | 如何核对和继续分析？ | 日级聚合、排序、分页，以及当前筛选结果的 CSV 下载 |

桌面并列展示核心图表，移动端改为单列。排名默认前 5 项，可展开全部；顶部和图表旁的 ⓘ 说明来源状态、价格出处和统计口径。

**Token 统一显示为 M（百万）。** 头部摘要与图轴适度舍入，悬停标题和详细数值保留更高精度；金额仍为 USD，天数、响应数和工具调用数仍为次数，CSV / JSON 保留原始 Token 数值。小于 1 Token 的分位或情景计算值显示为 `<0.000001 M`，不假装是零。高级情景参数 q / g / d 仍用原始 Token 数编辑，并在旁边显示 M 换算。

**日期按钮筛选的是已有快照，不会重新采集。** 7D / 30D / 90D 均以报告截止日为锚点并包含该日；范围不足的按钮不可用，不再静默裁剪。“全部”仅指这份报告已有日期。要扩大范围，请重新运行 `/usage-report 90` 或 CLI 的 `--days` 参数。

**采集范围与当前筛选分开显示。** 默认命令尝试读取全部 28 个来源，但不代表每个来源都有记录或都读取完整；`--sources` 生成的是指定来源快照。清除页面筛选不能补回未采集来源，需不带 `--sources` 重新生成。`--offline` 仍限制 Cursor / Antigravity；来源状态保留失败、部分读取和无记录提示。旧报告未记录采集范围时只展示已知来源，不冒充全来源。

**先看 Token，再看金额。** 请求构成图按含缓存 Token 占比展示，不是请求次数；会话时长不作为工时或生产力指标展示。

<details>
<summary>Harness、请求类型和分类证据</summary>

Harness 对应数据中的 `source` 字段，表示工具来源，不表示一定在本机运行。`requestType` 与 Token 类型是两个独立维度：

| requestType | 页面标签 | 口径 |
|---|---|---|
| `non_tool` | 非工具调用请求 | 完整响应可确认没有工具调用 |
| `tool` | 含工具调用请求 | 响应中有工具调用或明确的工具调用结束标记；文字与调用混合也归此类 |
| `other` | 其他 / 无法判定 | 缺少完整响应、关联不可靠、旧汇总或来源尚不支持分类 |

整条请求的 usage 只归一类，不按工具数重复计数，也不表示工具自身消耗。环图中央显示可分类 Token 比例，无法判定的部分明确保留。

| Harness | 分类证据 | 仍归 `other` 的情况 |
|---|---|---|
| Pi / Oh My Pi、Claude Code | 完整响应与工具调用；流式片段及副本保留正面工具证据，usage 只计一次 | 缺少响应或正常完成证据 |
| Codex | 请求边界间的完整 `response_item` 与推进的单次 `token_count`；新版账本额外核对 usage / response / turn / thread 关联 | 累计量回退、缺边界或输出、冲突 ID、损坏记录、旧账本 |
| ZCode | `part.message_id` 关联 assistant message；有 tool 优先，无 tool 且 `finish=stop` 才归非工具请求 | 缺 part 表或字段、损坏记录、未结束或 content-filter 等结束原因 |
| Kimi Code | 新格式匹配 step UUID / turn / usage；旧格式匹配 StepBegin / StepRetry 至完整 token usage | 缺边界、usage 不匹配、中断、无法关联的 session scope / 压缩账本；不混入子代理事件 |
| 其他来源 | 尚未建立可靠请求级关联 | 保留 `other`，不猜测 |

Codex 的 `token_usage_record` 仅用于核对完成证据，不叠加到 `token_count` 计量，也不把整个 turn 当作一次请求。分类补全不改变四类 Token、去重或价格口径；旧解析缓存会自动失效。

导入旧 JSON 时，缺失的 `requestType` 默认归其他。更新 HTML 无法恢复旧汇总中丢失的信息，需要重新读取日志。完整证据与本地补丁见 [parser attribution](vendor/vibe-usage/NOTICE.md)。

</details>

### Code Mode 成本影响与诊断证据

当前只解析 **原生 Pi 日志中的 Code Mode 结构化证据**，已对照 `@howaboua/pi-codex-conversion` 3.0.33 的 trace / exec / wait 格式验证。不需要新增实时埋点、修改 Code Mode 设置或调用模型；重新生成报告即可分析已有日志。其他来源、旧版汇总或缺少可识别 Code Mode 结构的 exec 显示无证据 / 未知，**不是零调用，也不是已关闭 Code Mode**。

| 指标 | 分母与含义 |
|---|---|
| 批处理覆盖率 | 内层工具数 ≥ 2 的精确 exec 数 ÷ 精确 exec 总数 |
| 平均内层工具数 | 精确 exec 的内层工具总数 ÷ 精确 exec 总数 |
| 中位数 / P75 | 合并原始计数直方图后线性插值；不平均各会话中位数，不先把 5+ 桶压成 5 |
| 精确样本覆盖率 | 可恢复完整调用数的 exec ÷ 已记录 exec；pending、unknown 单独列出 |
| 已记录 assistant 响应 | 按 provider / model / response ID 去重；无 response ID 时使用会话 / entry ID，仍缺 ID 时按匿名记录保留 |
| 平均完整输入 | 具有完整 usage 的响应中，`input + cacheRead + cacheWrite` 的平均值；同时展示输入样本覆盖率 |

**这些观测指标本身不能识别省费率。** 已记录响应包含中断、错误与缺少 usage 的记录，不等同于完整 HTTP 请求数或付费请求数。高均值可以来自一次有效批处理，也可以来自循环重试；没有通用的 2.5 次盈亏线。新增成本情景计算器把费用影响落到明确假设下的 Token / 美元差额，不把假设结果冒充已测得的净节省或任务质量。

<details>
<summary>执行证据、过滤与缺失值</summary>

- 一个 exec 在多次 wait 后仍只算一次；wait 本身保留为外层调用，不增加 exec 分母。exec 的最终结果归原始调用响应，wait 响应有独立的模型与输入记录，跨午夜也按原始响应时间归属。
- 内层调用按 exec 运行时记录的工具边界计数，不是 shell 命令条数；工具内部再发出的网络请求或其他模型调用不由此计量。
- 重复 trace ID 不重复计数。终态快照的保留 trace 数加累计 `droppedTraceCount` 可恢复总调用数，不能再加上早期快照。被截断工具的名称、状态和退出码无法补回；错误计数仅是观测下界。
- 已识别原生结构的无工具终态才记为 0：该运行时会省略空 `traces` 与为零的 `droppedTraceCount`，包括成功的纯 JS 执行；这不同于整块 Code Mode 结构缺失。未完成归 pending，缺结果、无法关联或矛盾结构归 unknown；累计 dropped 计数在终态回退也归 unknown，不猜测补齐。pending / unknown 已观察到的内层工具数另列为下界，不加入精确直方图。
- 外层脚本 / exec 错误、内层 trace 错误、`exec_command` 明确非零退出码分别计数。一个执行可能同时有多类错误；未观察到错误不保证成功，不生成统一失败率。
- 完整输入字段缺失保留 `null`，不按 0 补齐；输入平均值只用有证据的样本。`outputTokens` 是原生日志含 reasoning 的输出总量，只在独立 execution 数据集中使用，不与 Token 明细重复相加。
- 模型 / 会话汇总使用响应自身的来源与哈希，不猜测会话的模型，不从项目 / 日期拼接 Token 桶。跨文件复制的响应 ID 去重后保留首次观察的归属；匿名记录无法可靠跨文件去重。
- `mode` 的 `code_mode` / `other_tools` / `no_tools` / `unknown` 描述响应中的已观测证据，不读取配置、不自动识别实验组。筛选到不支持的来源时，没有执行证据，不影响原有 Token 与计价视图。

</details>

### Code Mode 成本影响：直接调用情景

在看板的 Code Mode 成本影响区域，对比 **同一批可估响应** 的日志 Token、按当前费率重算的费用，以及假设将内层工具展开为直接调用后的 Token / 费用。差额为 **直接调用 − Code Mode**：正值表示本情景中 Code Mode 较省，负值表示较贵。批处理覆盖率、调用数分布等保留为估算依据，不再是独立的第五视图；旧 `#execution` 链接仍可定位到此区域。此处只支持原生 Pi 证据的限制，不影响其他 Harness 的整体用量分析。

这是**固定后续历史的局部窗口反事实**，不是实际关闭开关重跑，也不是整段会话成本预测。每个已有 assistant 响应是一个计算起点；同一响应内多个 exec 的工具总数先合并，再计算新增模型轮数。其他响应、wait 行为、窗口结束后的历史及任务轨迹保持原记录，不把未模拟的部分当成已确认没有成本影响。

| 假设 | 默认与作用 |
|---|---|
| 每轮直接调用工具数 B | 默认 1（串行），同时对照 2 / 4 / 全批调用。关闭 Code Mode **不意味着**每工具必须请求一次模型；全批是忽略依赖的理想情景，未必可行 |
| 可复用前缀的缓存命中比例 | 默认沿用该响应的 `cacheRead / fullInput`，这是外推假设；可比较无缓存与 100% 复用。新出现的文本第一次仍按未缓存输入计费 |
| 每新增轮输出 q | 默认 0，含额外思考；未计入不等于实测没有 |
| 每轮新增工具上下文 g | 默认 0，表示未被 r 覆盖的可见调用 / 结果等进入上下文的净增量；避免与回放输出双算，未从正文自动猜 Token |
| Code Mode 净额外输出 d | 默认 0，不自动认定脚本都是浪费；假设可移除的输出开销，每响应最多扣到已有输出量。可用于检验 Code Mode 反而更贵的情景 |
| 输出回放比例 r | 默认 0，范围 0–1；输出含思考，不能自动全当成下一轮输入。r 只影响输入回放量，不免除生成输出的费用。回放量按每轮输出四舍五入为 Token；r=1 是全部输出也进入后续输入的额外假设，未必符合实际 API |

默认值主要估算已有输入前缀的额外重发，**未自动计输出回放、新增工具上下文 / 额外思考，也未扣 Code Mode 自身输出开销**。这些量未计不表示实测为零；串行情景常给出更大的重复输入估计，不能当作唯一基线。对照表是参数敏感性分析，不是置信区间或可信上下界；各行情景的定价覆盖可能不同，覆盖不同的金额小计不能直接比较。

只纳入有正向 Code Mode 证据、所有 exec 都有精确计数、内层工具总数大于零且输入 / 缓存 / 输出 usage 完整的响应。未完成、未知、纯 JS / 零内层工具和缺失 usage 分别排除并显示覆盖率，不外推到未覆盖会话。错误与重试轨迹保持固定，不推断关闭 Code Mode 后仍会发生同样错误。

费用使用本报告的同一套基础文本费率，不是订阅扣款或账单。缓存写仍按现有输入口径计价，不重建缓存资格 / 最小前缀 / TTL 溢价、长上下文阶梯、工具声明变化、媒体计费、窗口上限或压缩；100% 缓存与全批调用是敏感性假设，部分情景可能实际不可行。缺少兼容费率的模型保留 Token 估算，但金额为未知；仅对**完全相同的已定价子集**显示金额小计和覆盖率。execution 的输出含 reasoning，若本地覆盖将 reasoning 与普通输出定为不同费率，则金额不估，避免伪造输出拆分。

情景 CSV 下载记录所选参数、筛选条件、覆盖率及对照值；原始 `execution.csv` / `usage.json` 不被页面调整改写。计算全在本地，不需要新埋点、模型调用或上传；已有 v2 数据即可重新生成带计算器的报告。

<details>
<summary>计算公式与复现口径</summary>

对每个可估响应，令 P 为完整输入、C 为缓存读取、O 为含思考的输出、N 为全部 exec 的内层工具总数：

```text
新增轮数 a = max(ceil(N / B) − 1, 0)；全批调用时 a = 0
扣除输出 = min(d, O)
首轮直接输出 U = O − 扣除输出
可回放首轮输出 V = round(U × r)
可回放新增轮输出 Q = round(q × r)

新增输入 = a × (P + V) + g × a(a+1)/2 + Q × a(a−1)/2
可复用输入 = a × P + max(a−1,0) × V
             + g × a(a−1)/2 + Q × max(a−1,0)max(a−2,0)/2
首次出现输入 = 新增输入 − 可复用输入
新增缓存输入 = 可复用输入 × 假设命中比例
新增未缓存输入 = 新增输入 − 新增缓存输入

直接调用输入 = P + 新增输入
直接调用输出 = U + a × q
```

第一次新增请求重发 P，并首次看到 V 与工具上下文；之后的请求可以复用前面已经出现的内容，但新回放输出 / 工具上下文仍是新输入。输出是否回放取决于模型/API，不能从含思考的输出总量直接判定。缓存分量按假设比例分摊，可能含小数，不提前取整再计价。金额按模型逐条算后汇总，不拿总 Token 乘一个平均价格。

仅作合成示例：P=100、C=80、O=20、N=3，B=1，q/g/d/r=0，则新增两轮、200 输入 Token，直接调用总量为 320，日志原量为 120。沿用 80% 缓存时，新增输入分为 160 缓存与 40 未缓存；不是把全部 200 都按普通输入价收费。若额外假设 r=1，则新增输入为 240（176 缓存、64 未缓存），总量为 360。将 B 改为全批且 d=20，直接调用输出变为 0，差额反向——假设会改变结论。

</details>

## 命令行

例如，只分析三个来源最近 30 天的用量，按上海时区分组：

```bash
npx @geoqiao/pi-usage --days 30 --timezone Asia/Shanghai \
  --sources pi-coding-agent,claude-code,codex
```

| 参数 | 用途 / 默认值 |
|---|---|
| `--days 90` | 包含今天的日历日数量，范围 1–3660；默认 90 |
| `--timezone Asia/Shanghai` | 日期分组时区；默认系统 IANA 时区 |
| `--sources pi-coding-agent,codex` | 只读取指定来源；默认全部 28 类 |
| `--out /path/to/empty-directory` | 指定输出目录；非空目录会被拒绝，避免覆盖 |
| `--offline` | 禁止来源网络请求；Cursor 不可用，Antigravity 仅解析本地 DB |
| `--input /path/to/usage.json` | 从已有桶、会话及可选 execution 重新分析，不读取数据源 |
| `--prices /path/to/prices.json` | 用本地完整费率覆盖指定模型 |
| `--list-sources` / `--help` | 查看来源标识 / 命令帮助 |

重新分析已有数据，不重新采集：

```bash
npx @geoqiao/pi-usage --input /path/to/usage.json --days 90 --offline
```

`--input` 接受 `{ "buckets": [...], "sessions": [...], "execution": [...] }`，忽略原有费用，按当前本地价格重新计算。新导出为 `schemaVersion: 2`；旧文件缺少 `execution` 时按空数组兼容，不能凭旧桶恢复执行证据。execution 只保留白名单统计字段与哈希标识，验证计数守恒与缺失值；聚合计数字段必须完整提供，不把缺字段补成零。其他字段不会保留，也不会自动沿用外部 CSV 的疑似重复标记。来源完整性未验证，日期窗口仍以本次执行日为截止日。

## 报告与导出

| 文件 | 内容 |
|---|---|
| `index.html` | 数据、脚本和样式全部内嵌的交互报告 |
| `details.csv` | 解析器原始粒度的 Token 与费用明细，保留来源、模型、项目、终端和请求类型 |
| `sessions.csv` | 会话时长、消息数、开始和结束时间 |
| `execution.csv` | 响应级执行证据、哈希标识、精确 exec 直方图（JSON 字符串）、pending / unknown 和观测错误计数 |
| `usage.json` | 白名单字段构成的桶、会话、execution、读取状态、采集范围和价格，供再次离线分析 |

页面明细和顶部 CSV 下载按 **日期 × Harness × 模型 × 项目 × 终端 × 请求类型** 聚合，导出当前筛选结果；附 `knownCost`（已知小计）、`estimatedCost`（完整金额或空）、`coverage`（可计价 Token 比例）。同目录的 `details.csv` 和 `usage.json` 保留解析器原始粒度，不会随页面筛选变化。

新报告在 v2 格式中追加 `collectionScope`：`kind` 为 `all` / `selected` / `import`，`sources` 为来源标识列表，`offline` 为是否启用离线模式。它描述本次运行范围，不保证来源完整性；本地导入不会继承输入文件自称的采集范围，而是重新标为 `import`。旧文件无此字段仍可分析。

CSV 使用 UTF-8 BOM、标准引号转义与公式注入防护，可在 Excel 中打开。execution 不导出原始会话 / 响应 / 工具 ID、参数、结果、代码或图片，只保留哈希及统计。POSIX 上新建报告目录权限为 0700，文件为 0600。**报告包含项目名和终端名，哈希也可关联记录，属于私人文件；不要放进自动同步的公共目录。**

## 数据源与隐私

保留 [Vibe Usage](https://github.com/vibe-cafe/vibe-usage) **0.10.21 的全部 28 个 parser**。本包独立维护，不是 VibeCafé 官方产品。

| 来源类型 | 支持工具 |
|---|---|
| CLI / 会话日志 | Claude Code、Codex、Grok、Copilot CLI、CraftAgent、Gemini CLI、OpenClaw、Oh My Pi、Pi、Qwen Code、Kimi Code、Amp、Droid、DeepSeek Harness、Trae CLI、WorkBuddy |
| 本地 DB / 编辑器存储 | Alma、DimAgent、OpenCode、Hermes、Kiro、MiniMax Code、MiMoCode、Cline、Roo Code、ZCode |
| 来源服务读取 | Cursor：用本机已有登录凭据从 cursor.com 下载明细；Antigravity：本地 DB，旧版加密历史可通过 127.0.0.1 只读 RPC 获取 |

**允许从来源获取数据，不允许上传采集结果。**

| 边界 | 行为 |
|---|---|
| 网络读取 | 仅允许 Cursor 固定 GET 导出地址和 Antigravity 本机两种读取 RPC；拒绝重定向与自定义 Cursor 服务地址 |
| 统计与日志 | 不向 VibeCafé、模型服务或遥测服务发送统计、项目名或消息正文；来源请求只携带认证所需的已有凭据 |
| 生成报告 | 只保存白名单统计字段，不保存 prompt / 回复 / 代码正文；解析器仅在本机读取日志提取用量 |
| HTML | 自包含，CSP 禁止连接、远程资源、表单和嵌入对象；脚本以 SHA-256 授权，无 CDN、远程字体或追踪像素 |
| 后台行为 | 仅在主动执行命令时生成快照；不含上游上传 API、sync、账号配置或 daemon，不需要 VibeCafé API key |

> 本包**不会卸载或停止已有 Vibe Usage daemon**；它若仍在运行，会继续独立上传。

<details>
<summary>来源目录、缓存、部分数据与去重</summary>

继承各 parser 的默认目录、归档和去重规则。常用环境变量覆盖包括 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`VIBE_USAGE_PI_SESSION_DIRS`；完整约定以固定版本上游代码为准。不读取 `~/.vibe-usage/config.json`，其中额外配置的根目录不会自动继承。

Cindy 本地账本归并到 Codex / Pi，不新增独立来源。Codex 使用可丢弃缓存 `~/.pi/usage/cache`（可用 `PI_USAGE_CACHE_DIR` 覆盖），不碰上游上传状态。首次索引超过上游非交互预算会报告「部分数据」，再次生成可续建缓存；部分来源失败不会阻止其他来源生成报告。

不同工具的数据完整度不同，部分只有 Token、没有会话；格式不支持或缺失的记录可能被跳过，无法还原已删除的日志。报告只能筛选采集窗口内的数据，日期快捷项以报告截止日为准。

会话按开始日期整体归属，不跨午夜拆分。活跃秒数是日志中可观测事件的估计，并非工时；并行会话时长可能相加超过自然时间。会话没有模型、Token 或费用，不做不可靠的日期 / 项目关联。

`totalTokens` 不含缓存读取，`allTokens` 包含缓存读取。复用来源级消息 / fork 去重，不使用服务端匿名副本的启发式去重，避免误删本地不同项目的相同用量。

</details>

## 计价口径

**费用是估算，不是账单；分位描述历史样本，不预测未来。**

随包提供 **2026-09-05 [models.dev](https://models.dev) 社区价格快照**：159 个基础模型、318 个精确标识（含 provider 前缀）。只取直接提供方的基础文本费率，保留来源 URL、日期与内容 SHA-256；不是从聊天费用拟合，也不声称逐条验证过厂商官网。运行时不会自动下载或更新价格。

| 注意项 | 处理方式 / 限制 |
|---|---|
| 未定价或缺费率 | 金额为 `null`，不是零；部分定价显示已知小计与可计价 Token 比例，不将其视为真实费用覆盖率 |
| 缓存写入与长上下文 | 缓存写入已并入输入，无法恢复其独立溢价；缺少逐请求上下文长度，无法重建阶梯价 |
| 实际账单 | 不含媒体计费、税费、批量折扣、订阅扣款或赠送额度；快照费率用于全部历史日期 |
| 分位样本 | 默认仅包含有用量日；「将无记录日按 0 纳入」是显式假设，不代表确认当天未使用 |
| 金额分位 | 与 Token 分位分开；完整日金额标明有效 / 排除样本，已知金额小计不能冒充完整金额 |
| 模型计价 | 按每天的四类 Token 重新计价，再取分位和极值；不把各类 Token 的分位乘价后相加，不推断节省、质量或生产力 |

<details>
<summary>本地费率覆盖与计算公式</summary>

用 `--prices` 指定本地 JSON。**每个覆盖项必须完整提供四项费率**，单位为美元 / 百万 Token：

```json
{
  "models": {
    "my-model": {
      "input": 5,
      "cacheRead": 0.5,
      "output": 30,
      "reasoning": 30
    }
  }
}
```

允许非负有限数字；`cacheRead: null` 表示缓存费率未知，遇到缓存用量时该桶不计价。按完整模型标识匹配，允许唯一的大小写差异；不会随意删除 `#service_tier=...` 后缀或猜测别名，特殊档位需按其完整标识覆盖。

```text
estimatedCost = (inputTokens × input
               + cachedInputTokens × cacheRead
               + outputTokens × output
               + reasoningOutputTokens × reasoning) / 1,000,000
```

目标费率齐备时，即使原模型未定价，也可模拟其用量。Min / Max 与各分位使用同一组样本日，不是单次请求极值、预算或未来上下限。区间图用细线表示 Min–Max、色带表示 P25–P75、圆点表示 P50、菱形表示 P90；Token 各行独立刻度，模型计价共用线性刻度。

</details>

## 开发与验证

在仓库根目录运行，无需构建：

```bash
node packages/pi-usage/bin/pi-usage.js --days 90
# 或将源码作为 Pi 扩展加载：
pi install ./packages/pi-usage
```

```bash
pnpm --filter @geoqiao/pi-usage test
pnpm --filter @geoqiao/pi-usage typecheck
pnpm --filter @geoqiao/pi-usage pack:check
```

这是无构建的 JavaScript 包。`typecheck` 执行语法检查和未修改上游文件的哈希验证，不是 TypeScript 类型推导。测试覆盖计价、分位、隐私、CSV / HTML 安全、CLI、Pi 命令与上游 parser 回归；部分 SQLite 测试需要系统 `sqlite3`，运行时 Node 22.15+ 可使用内置 SQLite。

<details>
<summary>报表实现、合成数据验证与价格快照维护</summary>

报表只计算当前可见视图及已展开的分析；成本情景缓存绑定当前响应数据与参数，筛选或假设改变后不会沿用旧结果。CSV 字段和情景参数定义位于 `src/web/`，与 Node 端共享，计价公式仍由 `src/counterfactual.js` 负责。

浏览器模块由 `src/report.js` 内联为单个脚本，保留离线 CSP；这不是通用 ESM 打包器，只接受受限的无别名 named imports。新增或修改模块需通过打包回归及浏览器验收，不支持的导入形式会直接报错。

前端验证与 CI 使用同一个入口，自动创建独立的临时合成报告，不读取个人日志。Playwright 仅为固定版本的开发依赖，不增加扩展运行时依赖：

```bash
pnpm --filter @geoqiao/pi-usage exec playwright install --only-shell chromium
pnpm --filter @geoqiao/pi-usage browser:test
```

检查桌面、平板与 390px 移动端、四个视图、看板内成本情景、组合筛选、日期快捷范围、下钻、键盘操作、信息对话框焦点、长名称、空状态、未定价、分页与原始 CSV 数值一致性，以及执行统计的覆盖率、直方图与旧数据空状态，并验证零外部请求。运行入口打印本次临时目录，保存合成截图与 `result.json`；失败以非零退出并保存当前页面截图。Linux CI 自动安装所需浏览器系统依赖。这些开发脚本与截图不进入发布包。

提供输出目录时，demo 同时在其中生成 `short/`（30 天）与 `legacy/`（无 execution / 采集范围元数据）两个合成变体。浏览器验收从当前打开的 demo URL 推导它们的位置并强制验证，不依赖固定临时目录，也不跳过失败断言。

更新价格需维护者单独下载公开的 `https://models.dev/api.json`，再执行：

```bash
node packages/pi-usage/scripts/prices.js /path/to/downloaded-catalog.json YYYY-MM-DD
```

快照保留来源与哈希；用户运行报告不会触发此流程。

</details>

## 许可与归属

[MIT](LICENSE)。解析器改编自 [Vibe Usage](https://github.com/vibe-cafe/vibe-usage)，版本、提交、原始哈希与本地补丁见 [NOTICE](vendor/vibe-usage/NOTICE.md)。价格来自 models.dev，保留其 [MIT license](data/models.dev-LICENSE)。

看板为独立实现，仅参考 VibeCafé 仪表盘的视觉与信息布局，未复用其网站代码、品牌资源或用户数据。本包与 VibeCafé 无官方关联。
