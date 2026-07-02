---
name: approve-inbox
description: >
  审批消息中心 v3 —— 待办审批收件箱。同步待办、AI 分析单据（结构化 5 段：总体结论/总体分析/
  单据字段分析/业务规则分析/附件分析），并打开一个独立的审批页面供用户在浏览器中查看与审批。
  当用户提到以下任何场景时使用此 Skill：
  "查看待办"、"处理待办"、"审批待办"、"收件箱"、"我的审批"、"有什么待办"、"看一下收件箱"、
  "待办列表"、"审批同意"、"批量审批"、"打开审批页面"、"审批消息中心"。
  即使用户只是说"看看有什么要审批的"、"帮我处理一下审批"，也应使用此 Skill：
  默认动作是启动并打开审批消息中心页面（web/server.mjs --open）。
---

# 审批消息中心 v3（approve-inbox）

待办审批收件箱：**同步待办 → AI 分析 → 在独立页面查看并审批**。

本 skill 的**主交付是一个可独立运行的审批页面**（零依赖 Node web 服务 + 单页前端）。
被调用时的默认动作 = 启动该页面并在浏览器打开，让用户直接审批。

```
待办来源 ──sync──► data/inbox.json + data/details/<id>.json
                         │  (agent-runner: claude -p → 5 段结构化分析)
                         ▼
                  web/server.mjs  ──normalize──►  v3 契约 (ApproveInboxData/Detail)
                         │
                         ▼
                  浏览器审批页面（列表 5 微调 + 详情 5 段）
```

## 一、默认动作：打开审批页面（最常用）

```bash
node <skill-dir>/web/server.mjs --open
```

- 启动零依赖 web 服务并**自动打开浏览器**到 `http://localhost:3891`（绑定 `127.0.0.1`，仅本机）。
- 端口已被占用时视为「服务已在运行」，直接复用并打开，不报错（可反复调用）。
- 端口可配：环境变量 `APPROVE_INBOX_PORT`（或 `PORT`）。
- 数据来源：**真实数据强制**。服务启动后会立即通过 YonClaw 本机 BIP 代理同步待办并触发智能分析；
  无真实数据时接口返回错误，不回退样例列表。

页面交互：
- **列表**：按风险高/中/低用颜色（红/橙/绿左边框 + 圆点）区分；智能标签直接显示值（最多 3 个，超出 `+N`）；
  每行有「通过 / 驳回」操作；顶部「批量通过」；tab 维度（全部待办 / 近 7 天已办 / 重要 / 需关注 / 低风险）。
- **详情抽屉（5 段固定顺序）**：① 总体结论（建议通过/需关注/建议拒绝，红绿灯）② 总体分析（≈40 字）
  ③ 单据字段分析（多条）④ 业务规则分析（多条，带命中依据）⑤ 附件分析。

## 二、同步待办（已具备）

```bash
node <skill-dir>/scripts/sync-inbox.mjs                 # 拉待办列表 → 写 v3 data/inbox.json
node <skill-dir>/scripts/sync-inbox.mjs --data <dir>    # 指定 data 目录（如 YonClaw 真实 data）
node <skill-dir>/scripts/sync-inbox.mjs --dry-run       # 只拉取打印计数，不写盘
```

> 取数经 **YonClaw 本机 BIP 代理**（端口动态，`detectProxy` 自动探测，凭据自动注入，无需 cookie）。
> 待办列表 API：`POST {proxy}/iuap-apcom-messagecenter/client/mobile/todo/items/PC/query`。
> `sync-inbox.mjs` 只负责【待办列表】→ inbox.json；**单据字段 / 附件 / AI 分析**由 `enrich-details.mjs`
> 负责（按需 `POST /api/enrich/:id` 异步子进程 + 前端轮询，或 server 内部每 5 分钟自动同步后批量分析）。enrich 出结论后会把
> advice/风险/smartTags **回填到 inbox 列表项**，并对「数据未找到」的旧单据打 tombstone 跳过。
> 无代理 / 无 inbox.json 时页面显示真实同步错误，不展示样例列表。
>
> **跨租户限制**：待办列表跨租户聚合，但代理注入登录态锁单租户（`generateADT.sub`）。他租户单据
> 取数必「数据未找到」→ sync 记 `meta.currentTenant`、normalize 标 `item.crossTenant`、enrich 跳过、
> 前端「仅看当前租户」开关（默认开）过滤 + 详情提示「需在 YonBIP 切换租户」。切换 YonClaw 租户后该租户单据即可取。
> **重新分析**：详情抽屉「重新分析本单」→ 异步 enrich（子进程不阻塞）+ 轮询；全局「同步全部」按钮跑一轮调度。
> 详情四态：跨租户 / 数据未找到 / 分析失败可重试 / 暂不支持类型（非 voucher），不再 blank。
>
> 已知：已办列表 API（`done/items/PC/query`）当前环境上游 404，已办 tab 依赖本地真实审批成功后的 done 写回；真实审批写回（通过/驳回）见下方「审批写回」节，经 `/api/approve` 复用 YonClaw 会话执行（iForm/MDF 已通；YNF 仍为详情/元数据阶段）。

## 三、AI 分析（已具备）

`scripts/agent-runner.mjs` 对单据 + 附件做分析，输出**结构化 5 段 JSON**。
**模型后端**：默认走**用友底层模型**（openclaw agent 同款：`deepseek-v4-flash`，经本机
`127.0.0.1:3211/api/open-platform-model/v1`，OpenAI 兼容、本地直连无需 token，约 2-3s/单），
失败自动**兜底本地 `claude -p`**。env：`APPROVE_INBOX_AGENT_PROVIDER=yonyou|claude`、
`APPROVE_INBOX_MODEL_BASE`、`APPROVE_INBOX_MODEL` 可覆盖。响应兼容 JSON 与 SSE 流式（`extractContent`）。

```js
import { runAgent, buildAnalysisPrompt } from "<skill-dir>/scripts/agent-runner.mjs";
const prompt = buildAnalysisPrompt(item, detail);            // 5 段 JSON 输出约束
const r = await runAgent(prompt, { files: ["/path/to/attachment"] });
// r.content = { conclusion, overallAnalysis, fieldAnalysis, ruleAnalysis, attachmentAnalysis }
```

- `conclusion.advice` ∈ `approve | caution | reject`（页面红绿灯三态）。
- 业务规则由 Agent 自主发现（金额超限、付款条款偏离、附件缺失、信息不一致等），每条须给 `evidence`。
- 无可用 claude 时返回 `{ error: "no_agent_available" }`，不影响页面（详情走兜底）。

分析结果兼容三种来源（见 `web/normalize.mjs`）：① 5 段 JSON（新格式）② ```json 围栏包裹的 JSON
③ 旧版 Markdown（`[ADVICE:*]` 标记，降级提取）。

## 四、目录结构

```
approve-inbox/
├── SKILL.md
├── widget/                       ← 驾驶舱智能待办 iframe widget（入口卡片）
├── web/                          ← 独立审批页面（本期主交付）
│   ├── server.mjs                ← 零依赖 HTTP + REST（支持 --open / EADDRINUSE 复用）
│   ├── index.html                ← v3 单页前端（列表 5 微调 + 详情 5 段，自带设计 token）
│   ├── normalize.mjs             ← 数据契约转换层（真实数据/5段JSON/Markdown → v3 契约，纯函数）
│   ├── normalize.test.mjs        ← normalize 单测（node:test，30 例）
│   └── sample-data.mjs           ← 仅保留为开发样例，不作为运行时列表兜底
├── scripts/
│   ├── agent-runner.mjs          ← claude -p 分析封装 + 5 段 prompt 构建
│   ├── bill-utils.mjs            ← 单据工具（类型检测/附件提取/变更对比，纯函数）
│   ├── md-to-html.mjs            ← Markdown/ADVICE 解析（纯函数）
│   ├── *.test.mjs                ← scripts 单测
│   └── (sync-inbox.mjs / approve-*.mjs ← 接真实环境时补)
└── data/                         ← 运行时数据（.gitignore 忽略）
    ├── inbox.json                ← 轻量索引（真实抓取后生成）
    ├── details/<id>.json         ← 单据详情 + analysis
    └── attachments/<id>/         ← 附件文件
```

## 五、REST API（web/server.mjs）

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/` | 审批页面（index.html） |
| GET | `/widget/` | 驾驶舱智能待办 iframe widget 页面 |
| GET | `/widget/manifest.json` | 驾驶舱 widget 注册 manifest（动态补本机 URL） |
| GET | `/api/inbox` | v3 `ApproveInboxData`（真实数据强制；启动/首次访问会触发真实同步，失败返回 503，不回退 sample） |
| GET | `/api/widget/todos?limit=3` | 轻量智能待办 widget 数据（只读缓存，不触发重型 enrich） |
| GET | `/api/runtime-context` | 安全运行态 URL；本地绝对路径需 `APPROVE_INBOX_EXPOSE_RUNTIME_PATHS=1&full=1` |
| GET | `/api/details/:id` | v3 `ApproveInboxDetail`（5 段；真实/fallback） |
| GET | `/api/attachments/:id/:file` | 附件下载 |
| POST | `/api/widget/refresh` | 驾驶舱 widget 轻量刷新接口；同步待办缓存，不触发重型 enrich |
| POST | `/api/sync` | 执行真实待办同步，并触发后台智能分析；失败返回真实错误 |
| POST | `/api/approve` | `{ ids: [] }`，真实数据先执行真实审批，成功后落本地 done |
| POST | `/api/shutdown` | 优雅关闭 |

所有对外数据均经 `normalize.mjs` 转为 v3 契约（对齐 `src/types/approve-inbox.ts` 与
`docs/jsonSchema/approve-inbox.schema.json`）。

## 六、驾驶舱智能待办 widget

驾驶舱可通过 `GET /widget/manifest.json` 发现 iframe 入口，并加载 `GET /widget/`。widget iframe 内
不渲染大标题和刷新按钮，这两项由驾驶舱标题栏提供；内容区展示待办总数、高优先级、需关注、最多 3 条
待办和简短 Magic 摘要。驾驶舱标题栏可调用 manifest 中的 `refreshUrl`（`POST /api/widget/refresh`）
执行轻量刷新；它只做入口与预览，不直接审批。

驾驶舱抽屉内完整列表使用 `/?embed=cockpit-drawer&detailOwner=host`。该模式不渲染 skill 自带标题、
返回按钮和刷新按钮，点击待办只通过 `approve-inbox:request-detail` 通知宿主打开详情；`returnTo`
仅用于安全 origin 兼容，不驱动可见返回入口。

YonClaw/驾驶舱服务也可以直接调用 runtime context tool：

```bash
node <skill-dir>/scripts/runtime-context.mjs --format json
```

该 CLI 返回 `skillDir/dataDir/profileDir/runtimeDir/openclawDir/serverUrl/widgetUrl/centerUrl`。
HTTP 版本默认只返回安全 URL，避免把用户本机路径泄露给 iframe 消费方。

服务启动后会立即执行一次真实待办同步，并触发内容智能分析；之后由 `server.mjs` 内部每 5 分钟执行
一次“同步待办 → 分析未完成内容”的刷新循环，不依赖 YonClaw 或系统定时任务。默认刷新间隔可用
`APPROVE_INBOX_AUTO_INTERVAL` 调整，自动同步可用 `APPROVE_INBOX_AUTO_SYNC=0` 在测试场景关闭。

## 七、安全重启

```bash
curl -X POST http://127.0.0.1:3891/api/shutdown          # 停止
node <skill-dir>/web/server.mjs --open                   # 重启并打开
```

## 八、单据字段抓取（fetch-bill-detail）

把待办 `webUrl` 指向的真实单据明细字段抓回来（解决「只有元信息、无业务字段无法分析」）。

```bash
APPROVE_INBOX_PROXY="http://localhost:<port>" node <skill-dir>/scripts/fetch-bill-detail.mjs --url "<webUrl>"
```

- 链路：`uniform getTplId → {微服务}/report|bill/detail`。**单据详情走 `report/detail`（多数）或 `bill/detail`（如销售合同）**；`id`=webUrl 雪花 id；`serviceCode`=`<billnum>list`。
- 取数参数因单据类型而异，固化在 `analysis/fetch-profiles.json`（已验证：请购/入库/出差；销售合同结构已知；其余标 unverified，未命中走多候选自适应兜底）。
- 凭据经 **YonClaw BIP 代理自动注入**（无需 cookie）。代理端口动态 → enrich 自动探测。

抓取结果会生成 `richDetail` 富模型：

- `raw`：指向兼容详情数据（`billDetail` / `iformData`）及抓取来源。
- `meta.fields/enums/sections`：轻量模板索引，来自 MDF `/mdf-node/meta`、YNF `tplAndMeta`、iForm `billVue.json`，不长期保存完整模板大 JSON。
- `normalized.fields`：稳定展示与分析输入层，字段展示优先使用 `label/displayValue`，旧 `content.fields` / `billDetail` / `iformData` 只作为 fallback。

## 九、多套分析结构（通用维 + 业务维）

`analysis/` 预置按单据类型分化的分析套路，由 `agent-runner.buildAnalysisPrompt(item, detail, opts)` 组装：

- `dimensions.js` — 7 个通用维（金额合规/预算匹配/附件完整/信息一致性/审批权限/重复提交/时效）。
- `profiles/*.json` — 8 类业务 profile + `generic.json` 兜底（采购/费用出差/合同/入库/上线/数据申请/文件签署/通用审批），每个含 `commonDimensions`+`businessRules`(带 evidence 要点)+`keyFields`+`promptHint`。
- `field-dict.json` — 英文字段 key → 中文名 + 维度。
- `profile-loader.js` — `selectProfile(item)` 按 docType/billnum 选 profile（无命中→generic）；`localizeFields(fields)` 字段中文化。
- 向后兼容：`buildAnalysisPrompt` 不传 opts 时退回原通用 prompt。

## 十、字段→分析闭环（enrich-details）

```bash
node <skill-dir>/scripts/enrich-details.mjs --data <YonClaw data 目录> --limit 3 [--id <id>] [--force] [--no-analyze]
```

串起：读 inbox → `fetchBillFields` 抓字段 → `selectProfile`+`localizeFields` → `buildAnalysisPrompt` → `runAgent`(claude -p) → 写回 `details/<id>.json` 的 `content`(字段)+`analysis`(5段)。代理端口自动探测；已分析默认跳过（`--force` 重跑）。

## 十一、Eval 评估框架

```bash
node <skill-dir>/eval/eval-runner.mjs            # replay（默认，离线/CI 零成本）
node <skill-dir>/eval/eval-runner.mjs --real     # 真调 claude -p 并录制 golden
node <skill-dir>/eval/eval-runner.mjs --mock     # 纯打分器自测
```

- `eval/scenarios/*.json` — 16 个 golden fixture（单据类型 × 风险情形），含 `input` + `expect`(advice/mustHitRules/fieldSeverity) + `mock`。
- `eval/scorers.mjs` — 确定性分维度打分：结构合规30% + advice准确30% + 规则命中25% + severity合理15%，门槛 0.7。
- `eval/recordings/` — `--real` 录制的真实输出（golden 参考 + replay 回放）。

## 十二、测试

```bash
node --test <skill-dir>/scripts/*.test.mjs <skill-dir>/web/*.test.mjs \
            <skill-dir>/analysis/*.test.mjs <skill-dir>/eval/*.test.mjs
```

## 审批写回（通过 / 驳回 —— 经 `/api/approve` 分流真实执行）

审批写回**在本 skill 内实现**：页面 / agent 调 `POST /api/approve`
（`{ ids, action, comment, rejectTarget, selectedByRejecter, fieldAssignments }`），由
`scripts/approval-executor.mjs` 的 `executeApproval` 分流执行。普通 MDF/BIP 工作流默认走
**YonClaw 本机 BIP 代理会话**，调用 `iuap-apcom-cli/scripts/bip-cli.js` 中 `workflow task batch-approve` / `batch-reject`
同源的 todocenter 接口；不要求用户额外维护 `bip-cli yonbrowser login` 登录态，也不使用本地伪成功或前端直接挪状态。
传给接口的 `primaryIds` 是 todocenter 待办 `primaryId`（即列表 item id）；workflow `taskId` 仅作为详情/调试辅助字段，不用于 `batch-approve` / `batch-reject`。
同步待办时必须读取原始 `buttons` 生成 `runtimeActions`；`runtimeActions` 是上次观察到的动作快照（同时兼容 `observedActions` 语义），字段包含
`kind/source/observedAt/requiresRefresh/endpointHint` 等诊断信息。没有同意 / 退回按钮的通知类待办（如“退回制单待办”“任务提醒”）不展示审批动作。
后端真实执行前会先通过 handler/framework `refreshActions()` 刷新动作；刷新失败或刷新后没有匹配动作时，不调用真实审批接口。

`bip-cli.js` 解析顺序：`APPROVE_INBOX_BIP_CLI` / `BIP_CLI_PATH` / `IUAP_APCOM_CLI_DIR` →
`APPROVE_INBOX_DATA` / `APPROVE_INBOX_SKILL_DIR` 所在 profile 的 sibling `iuap-apcom-cli` →
相邻 `../iuap-apcom-cli/scripts/bip-cli.js` → 常见个人 skills 目录 → YonClaw profiles 下的 runtime skills。

按单据框架分发（`detectApprovalFramework`）：

| 框架 | 通过 | 驳回 / 退回 |
|------|------|------------|
| iForm | `POST /yonbip-ec-iform/wf_ctr/audit`（需登录态） | `POST /yonbip-ec-iform/wf_ctr/doAction`（`actionCode=reject`） |
| MDF / 普通工作流 | `POST {YonClawProxy}/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action`，`callBackExecType=agree` | 同接口，`callBackExecType=reject` |
| 紧急补丁 MDF | `approve-patches.mjs` 经 YonClaw 代理保存审批意见 → 同意接口 | 退回接口 |
| YNF | 第一阶段仅抓详情 / 元数据，暂不执行真实写回 | 同左 |

执行要点：
- **代理 / 登录态**：MDF/BIP 普通工作流优先复用 YonClaw 本机 BIP 代理会话 / cookie。仅在显式设置 `APPROVE_INBOX_APPROVAL_TRANSPORT=cli` 时走 `bip-cli.js` 本地登录态。
- **动作可用性**：待办原始 `buttons.callBackExecType` 只作为 observed snapshot，`agree` → `approve`，`reject` → `return/reject`；执行前刷新动作后仍不可用则返回 `type:"unavailable"`，刷新失败返回 `type:"action_refresh_failed"`，都不触发真实审批。
- **审批策略**：handler 通过 `approvalStrategy()` 声明执行方式（普通 batch、iForm audit、补丁 save-then-batch、unsupported），`/api/approve` 只调用统一 executor，不硬编码具体单据分组。
- **成功判定**：CLI/iForm 结果统一归一为 `successIds`。`/api/approve` **真实写回成功后**才把对应单据落 done；失败不落，并如实回传 `results`。
- **边界**：MDF / 普通工作流的驳回 / 退回统一走 `callBackExecType=reject`，暂未暴露退回目标等高级参数；YNF 暂不执行真实写回。遇限制如实告知用户，不静默失败。

## 参考实现

真实抓取/审批链路（sync-inbox / approve-iform / approve-patches / approve-with-assign / bip-cli +
微服务映射 + 类型检测规则）见参考仓库 **git.yyrd.com/liujian-research/approve-inbox**。
本 skill 的 `bill-utils.mjs`（detectType / extractAttachments / detectChanges）已对齐其类型检测规则，
接入真实环境时可据此补齐 `sync-inbox.mjs`。
