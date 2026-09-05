# @geoqiao/pi-usage

**获取 AI 编程工具的使用数据，在本机计价、分析并生成可离线打开的 HTML 报告；不上传统计数据。**

参考 [Vibe Usage](https://github.com/vibe-cafe/vibe-usage) 的解析代码和登录后仪表盘布局。
独立维护，非 VibeCafé 官方产品。无运行时 npm 依赖，无后台服务，无 LLM 分析调用。

## 安装与使用

需要 **Node.js ≥ 22.15**。

```bash
pi install npm:@geoqiao/pi-usage
# 不安装 Pi 扩展，仅运行 CLI：
npx @geoqiao/pi-usage --days 90
```

安装后在 Pi 中运行（已打开的 Pi 先 `/reload`）：

```text
/usage-report
/usage-report 30
```

命令不触发模型回合，不将统计结果注入对话；UI 提示报告的本地路径。
生成过程在独立 Node 子进程中执行，避免同步解析阻塞 Pi。退出或重载 Pi 会取消该进程。

也可从源码运行，无需构建：

```bash
# 在 pi-tools 仓库根目录运行
pi install ./packages/pi-usage
node packages/pi-usage/bin/pi-usage.js --days 90
```

默认写入 `~/.pi/usage/reports/report-<随机后缀>/`。双击 `index.html` 即可打开；不需要本地 Web 服务器。
每次生成独立快照，不会覆盖旧报告。

| 文件 | 内容 |
|---|---|
| `index.html` | 数据、脚本和样式全部内嵌的交互报告 |
| `details.csv` | 解析器原始粒度 × Harness × 模型 × 项目 × 终端 × 请求类型的 token 与费用明细 |
| `sessions.csv` | 会话时长、消息数、开始和结束时间 |
| `usage.json` | 字段白名单后的桶、会话、读取状态和价格；可再次离线分析 |

CSV 使用 UTF-8 BOM、标准引号转义与公式注入防护，可直接在 Excel 中打开。
POSIX 上新建报告目录权限为 0700，文件为 0600。报告含项目名和终端名，仍属于私人文件；不要放进自动同步的公共目录。

## 命令行

```bash
pi-usage --days 90 --timezone Asia/Shanghai
pi-usage --sources pi-coding-agent,claude-code,codex --days 30
pi-usage --out /absolute/path/to/empty-report-directory
pi-usage --prices /absolute/path/to/prices.json
pi-usage --input /absolute/path/to/usage.json --days 90 --offline
pi-usage --offline
pi-usage --list-sources
pi-usage --help
```

`--days` 为包含今天的 1–3660 个日历日，默认 90；日期按 `--timezone` 分组，默认系统 IANA 时区。
报告只能筛选采集窗口内的数据，不能凭空补回已删除的日志。`--out` 必须为空目录；非空即拒绝写入。
`--input` 接受 `{ "buckets": [...], "sessions": [...] }`，不读取数据源，忽略原有费用并用本地价格重新计算。
输入文件的其他字段不会被保留；来源完整性未验证，也不会自动沿用外部 CSV 中的疑似重复标记。

## 交互分析看板

每次主动执行命令读取已有数据并生成快照，不做定时采集。默认回答 **「这段时间用了多少，主要用在哪？」**：含缓存 Token 优先，金额辅助。浅色分析画布、图标工具栏与四个视图代替长篇摘要；桌面首屏并列展示核心图表，移动端改为单列。

| 视图 / 操作 | 内容 |
|---|---|
| 看板 | 四类 Token 指标、日堆叠趋势、请求构成环图、Harness 排名、可切换维度排名、每日频数与分位区间 |
| 联动筛选 | 日期 / Harness / 模型 / 项目 / 终端 / 请求类型组合筛选；点击柱形、排名或请求类型加入同一筛选状态，标签可单独移除或清除全部 |
| 日分布 | 六项 Token 指标的区间图与 Min / P25 / P50 / P75 / P90 / Max；完整日金额显示有效与排除样本，精确表格及每日数值可展开 / 核对 |
| 模型计价 | 对当前筛选的每天四类 Token 逐日重新计价；共用线性刻度区间图与全部六个金额，默认 P50 排序，可切换 P90 / Min / Max |
| 明细 | 日级聚合完整数值、分页与排序；顶部下载图标导出当前筛选的日级 CSV |
| 信息入口 | 顶部 ⓘ / 快照状态打开来源、价格出处与口径；图表旁 ⓘ 打开对应说明，Escape 关闭并返回焦点 |

页面明细及顶部下载按 **日期 × Harness × 模型 × 项目 × 终端 × 请求类型** 聚合，CSV 附 `knownCost`（已知小计）、`estimatedCost`（完整金额或空）、`coverage`（可计价 Token 比例）。
同目录自动生成的 `details.csv` 与 `usage.json` 仍保留解析器原始粒度，供进一步分析；没有改变源数据或解析缓存。
Token 四类颜色跨指标、趋势和排名保持一致；请求类型单独成图，不混成第五类 Token。排名默认前 5 项，可展开全部并在面板内滚动；长名称用省略显示，悬停或辅助技术可读取全名。页面不展示工时、生产力或分时活跃指标；会话数据仍保留在 JSON / sessions.csv。
日期快捷项以报告截止日为准，旧报告不会随当前日期变化或自动更新。

### 请求类型与 Harness

UI 的 **Harness 对应 `source` 字段**，包括 Pi、Claude Code、Codex，也保留 Cursor 等来源；不表示都在本机运行。新的 `requestType` 与 Token 类型是两个独立维度：

| requestType | 页面标签 | 口径 |
|---|---|---|
| `non_tool` | 非工具调用请求 | 完整响应可确认没有工具调用 |
| `tool` | 含工具调用请求 | 响应中有工具调用或明确的工具调用结束标记；文字与调用混合也归此类 |
| `other` | 其他（无法判定） | 旧汇总、缺少完整响应、关联不可靠或来源尚不支持分类 |

整条请求的 usage 只归一类，不按工具数重复计数，也不表示工具自身消耗。构成图的占比按**含缓存 Token**计算，不是请求次数；三个入口（下拉、构成按钮、排名下钻）使用同一筛选状态。环图中央显示可分类 Token 比例，灰色明确保留其他 / 未判定。可逐项移除筛选或清除全部。

分类支持与剩余 `other` 原因：

| Harness | 可审计的分类证据 | 仍归 other 的情况 |
|---|---|---|
| Pi / Oh My Pi、Claude Code | 原始完整响应与工具调用；流式片段及副本保留正面工具证据，usage 只计一次 | 缺少响应或正常完成证据 |
| Codex | 已知请求边界之间的完整 response_item 与推进的单次 token_count；新版 token_usage_record 额外核对 usage / response / turn / thread 关联 | 累计量回退、缺边界/输出、冲突 ID、损坏记录、旧账本；不把整个 turn 视为一次请求 |
| ZCode | part.message_id 精确关联 assistant message；有 tool 优先，无 tool 且 finish=stop 才归 non_tool | 缺 part 表/字段、损坏 part、未结束或 content-filter 等结束原因 |
| Kimi Code | 新格式匹配 step UUID / turn / step.end.usage 与 usage.record；旧格式 StepBegin / StepRetry 至完整 StatusUpdate.token_usage | 缺 step 边界、usage 不匹配、中断、无法关联的 session scope / 压缩账本；不混入子代理事件 |
| 其他来源 | 尚未建立可靠请求级关联 | 保留 other，不猜测 |

Codex 的 token_usage_record 仅用于核对完成证据，不叠加到既有 token_count 计量，因此分类补全不改变四类 Token、去重或价格口径。解析缓存算法已升级，旧结果及增量尾缓存会自动失效。导入旧 JSON 时缺失的 `requestType` 默认归其他；更新 HTML 不能恢复旧汇总中丢失的信息，需要重新读取日志。

Min / Max 是当前样本日的最小 / 最大观测值，与四个分位同样本；目标模型逐日计价后再取极值。区间图以细线表示 Min–Max、色带表示 P25–P75、圆点表示 P50、菱形表示 P90。Token 分位各行独立刻度，模型计价共用刻度。不是单次请求极值、预算边界或未来上下限。移动端趋势按可用宽度重绘；表格可局部横向滚动，第一列保持可见。

## 本地价格表

随包提供 **2026-09-05 models.dev 社区价格快照**：159 个基础模型 / 318 个精确模型标识（含 provider 前缀）。
不是从聊天中的费用拟合而来，也不声称逐条验证过厂商官网；每条记录保留提供方和文档来源。
只取直接提供方的基础文本费率，不随意选代理商价格。运行时不会自动下载或更新价格。

用 `--prices` 指定本地 JSON 覆盖；**每个覆盖项必须完整提供四项费率**：

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

单位：**美元 / 百万 token**。允许非负有限数字；`cacheRead: null` 表示缓存价格未知，遇到缓存用量时该桶不计价。
按完整模型标识匹配，允许唯一的大小写差异；不随意删除 `#service_tier=...` 后缀或模糊猜测别名。特殊档位可按其完整标识自行覆盖。

```text
estimatedCost = (inputTokens × input
               + cachedInputTokens × cacheRead
               + outputTokens × output
               + reasoningOutputTokens × reasoning) / 1,000,000
```

未知模型和缺失费率的费用为 `null`，不是零。完全未定价的分组显示「未定价」，部分定价明确标识；金额占比仅相对于已知小计。覆盖率按**含缓存 Token 数**计算，不代表真实费用覆盖率；不会据此自动切换排名指标。
Token 分位与完整日金额分位分开展示，后者标出有效 / 排除日期数量及样本偏差风险，另列全部样本日的已知金额小计分布，不将其冒充完整金额。
分位与模型计价共用日期样本，默认仅有用量日。「将无记录日按 0 纳入」是显式假设，不表示已确认当天未使用。
模拟按每天整体重计价后求分位，**不把各类 Token 的分位乘价再相加**。目标费率齐备即可模拟原模型未定价的用量；不展示实际节省、质量或生产力推断。

### 估算限制

上游将缓存写入并入 `inputTokens`，无法恢复独立缓存写入数及溢价；因此该部分只能按普通输入费率估算。
桶也不保留每次请求的上下文长度，无法重建长上下文阶梯价。价格快照用于全部历史日期，不是历史有效期价格表。
不含媒体计费、税费、批量折扣、实际订阅扣款、赠送额度等。覆盖率只说明能套用费率，不保证账单精度。

## 数据源与隐私边界

保留上游 0.10.21 的全部 **28 个 parser**：

| 类别 | 工具 |
|---|---|
| CLI / 会话日志 | Claude Code、Codex、Grok、Copilot CLI、CraftAgent、Gemini CLI、OpenClaw、Oh My Pi、Pi、Qwen Code、Kimi Code、Amp、Droid、DeepSeek Harness、Trae CLI、WorkBuddy |
| 本地 DB / 编辑器存储 | Alma、DimAgent、OpenCode、Hermes、Kiro、MiniMax Code、MiMoCode、Cline、Roo Code、ZCode |
| 来源服务读取 | Cursor：用本机已登录凭据从 cursor.com 下载使用明细；Antigravity：本地 DB，旧版加密历史可通过本机 127.0.0.1 只读 RPC 获取 |

另继承上游 Cindy 本地账本读取，归并到 Codex / Pi，不新增独立 source。
继承各 parser 的默认目录、环境变量覆盖、归档和去重规则。常用覆盖如 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`VIBE_USAGE_PI_SESSION_DIRS`；完整来源约定以固定版本上游代码为准。
不读取 `~/.vibe-usage/config.json`，其中配置的额外根目录不会自动继承；可用对应来源环境变量设置目录。
不同工具可提供的数据不同，部分仅有 token，没有会话。缺少或格式不支持的记录可能被上游跳过，不能承诺还原已丢失的历史。

**允许获取源数据，不允许上传采集结果：**

- 不包含上游 `api.js`、`sync.js`、账号配置、daemon 或上传入口，不需要 VibeCafé API key。
- 唯一网络边界只允许 Cursor 的固定 GET 导出地址，以及 Antigravity 本机的两种读取 RPC；拒绝 HTTP 重定向和自定义 Cursor 服务地址。
- 不把统计数据、项目名、消息内容发送给 VibeCafé、模型服务或遥测服务。Cursor 请求仅携带向该来源认证所需的已有凭据。
- HTML 使用 CSP 禁止连接、远程资源、表单和嵌入对象；唯一脚本以 SHA-256 授权。没有 CDN、远程字体、追踪像素或外链资源。
- `--offline` 进一步禁止所有来源网络请求；Cursor 无法读取，Antigravity 只能解析本地 DB。
- 只保存白名单统计字段，不保存 prompt / 回复 / 代码正文。解析器会在本机读取日志来提取用量。

Codex 使用独立可丢弃缓存 `~/.pi/usage/cache`（`PI_USAGE_CACHE_DIR` 可覆盖），不碰上游上传状态。
首次索引超过上游非交互预算时会报告「部分数据」，再次生成可续建缓存。所有报告均展示读取状态，部分失败不阻止其他来源生成报告。
没有后台采集或自动上传任务。**本 package 不卸载或停止已有 Vibe Usage daemon；它若仍在运行，会继续独立上传。**

### 会话与去重

会话按开始日期整体归属；时长不按跨午夜裁剪。活跃秒数是上游能观测到的首条回复至该轮最后事件的估计，并非用户工时。
并行会话时长可能相加超过自然时间。会话没有模型、token 或费用，仅作为独立导出保留，不做不可靠的日期 / 项目 join。
`totalTokens` 不包含缓存读取；`allTokens` 包含缓存读取，两者均单独展示。
复用来源级消息 / fork 去重，不应用此前聊天中服务端匿名副本的启发式去重，避免误删本地不同项目的相同用量。

## 开发与验证

```bash
pnpm --filter @geoqiao/pi-usage test
pnpm --filter @geoqiao/pi-usage typecheck
pnpm --filter @geoqiao/pi-usage pack:check
```

这是无构建的 JavaScript 包；`typecheck` 工作区钩子执行 JavaScript 语法检查和未修改上游文件哈希验证，不是 TypeScript 类型推导。
`node:test` 覆盖计价 / 分位、隐私边界、CSV/HTML 安全、CLI、Pi 命令和保留的上游 parser 回归测试。
部分上游 SQLite 测试需系统 `sqlite3`；运行时 Node 22.15+ 可使用内置 SQLite。

前端验证（合成数据，不读取个人日志）：

```bash
node packages/pi-usage/scripts/demo.js /tmp/pi-usage-demo
PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=1 playwright-cli -s=pi-usage open file:///tmp/pi-usage-demo/index.html
playwright-cli -s=pi-usage run-code --filename=packages/pi-usage/scripts/browser-check.js
playwright-cli -s=pi-usage close
```

使用已有 `playwright-cli`，不作为运行时依赖。检查桌面 / 390px 移动端全部视图、组合筛选与下钻、键盘日期查询、信息对话框焦点、长名称与 HTML/CSV 防护、未定价与空状态、分位样本、模型计价排序、分页，以及实际 CSV 内容与筛选后原数据总量 / 日聚合条数一致。验证零外部请求；合成截图写入 `/tmp/pi-usage-bi-demo-*.png`。脚本也可验收已有报告；私有报告请在仓库外的临时目录运行浏览器，以免下载和浏览器快照进入工作区。
更新价格需维护者先单独下载公开 `https://models.dev/api.json`，再执行：

```bash
node packages/pi-usage/scripts/prices.js /path/to/downloaded-catalog.json YYYY-MM-DD
```

快照保留来源 URL、下载日期、内容 SHA-256；用户运行报告不会触发此流程。

## 许可与归属

MIT。上游解析器版本、提交、原始哈希和本地补丁记录于 [NOTICE](vendor/vibe-usage/NOTICE.md)。
价格快照来自 [models.dev](https://models.dev)，保留 [MIT license](data/models.dev-LICENSE)。
页面是独立实现，只参考仪表盘视觉与信息布局，不包含 VibeCafé 网站代码、品牌资源或个人数据。
