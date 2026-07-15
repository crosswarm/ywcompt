# approve-inbox — 智能待办（需求与方案）

> 📌 **模块需求文档已归位**：`docs/spec/modules/yoncockpit-approval-message-center-v3.md`（模块级权威需求）。本文件为技术方案与实现细节补充，二者配套。
> 状态：**独立 skill 开发中** · 数据契约：[approve-inbox.schema.json](../jsonSchema/approve-inbox.schema.json)
> 最近更新：2026-06-16（反写本轮全部需求与架构演进）

---

## 1. 定位与架构（重要变更）

approve-inbox =「智能待办」。本期**先作为独立 skill 开发**：可单独运行、单独页面查看与审批；**集成进 YonCockpit 驾驶舱（Module Federation 外部组件）作为后续**，机制设计见 [external-component-registry](../architecture/external-component-registry.md)。

**架构定调（用户确认）**：

```
[yonclaw runtime]  ── 取数 ──►  用户自己的待办任务数据（拉取 + 转标准数据契约 + claude 分析）
                                      ↓ 落盘到 skill 的 data/
                            data/inbox.json（ApproveInboxData）
                            data/details/<id>.json（content + 5 段 analysis）
                                      ↓
[iuap-apcom-myapproval skill]  ── 处理 + 展示 ──►  web/server.mjs（REST）+ index.html（智能待办单页）
                                      ↓
                            浏览器审批页面（yonclaw 调用 skill 时 `--open` 打开）
                                      ↓
                            widget/（驾驶舱智能待办 iframe 入口）
```

- **数据获取 = yonclaw 负责**（用户待办任务数据），**处理与展示 = 本 skill 负责**。
- 与现有 `MessageCenterWidget`（businessType=`approval-message-center`）并存，不替换、不改动。

### 驾驶舱智能待办 widget（2026-06-29）

本轮新增 `approve-inbox-widget`，定位为驾驶舱里的轻量入口，不复刻完整审批中心，也不照搬示意截图。

- 资产目录：`skills/iuap-apcom-myapproval/widget/`，包含 `index.html/widget.css/widget.js/manifest.json`。
- 发现机制：`GET /widget/manifest.json` 返回动态本机 URL 和 `refreshUrl`，驾驶舱以 iframe 加载
  `GET /widget/`。
- 标题栏：widget iframe 内不渲染大标题和刷新按钮，这两项由驾驶舱标题栏提供。
- 数据接口：`GET /api/widget/todos?limit=3`，复用 `normalizeInbox`，只读缓存，不触发重型 enrich。
- 刷新接口：`POST /api/widget/refresh` 给驾驶舱标题栏调用，刷新待办缓存但不触发重型 enrich。
- 抽屉嵌入：驾驶舱加载 `/?embed=cockpit-drawer&detailOwner=host`；完整页面不显示返回入口，点击待办
  通过 `approve-inbox:request-detail` 让宿主打开详情。
- 运行时路径：`scripts/runtime-context.mjs --format json` 给 YonClaw/驾驶舱服务读取本机
  `skillDir/dataDir/profileDir/runtimeDir/openclawDir/serverUrl/widgetUrl/centerUrl`；
  `GET /api/runtime-context` 默认只暴露安全 URL。

## 2. 需求清单（本轮迭代，2026-06-16）

| # | 需求 | 状态 |
|---|------|------|
| R1 | 独立 skill：可单独运行（`node web/server.mjs`）+ 单独页面查看；yonclaw 调用时单独打开审批页面 | ✅ 已实现 |
| R2 | 列表 5 微调：①AI建议展示总体分析/重要规则意见 ②风险等级统一为重要/需关注/建议通过 ③智能 tag 去前缀、≤3 个超出 `+N`、带行操作（尤其批量通过）④详情 5 段见 R6 ⑤无顶部大指标卡 | ✅ 已实现 |
| R3 | 列表补充**提交人、提交日期**（meta 行） | ✅ 已实现 |
| R4 | **已办** tab 加总体**智能总结**，以审核数据统计 + 分析为主 | ✅ 已实现（统计现算，分析文字模板，后续可由 agent 增强） |
| R5 | 单据内容分析需要补齐丰富字段结构 | ◐ 进行中（受 R7 字段缺失制约） |
| R6 | 详情抽屉 5 段固定顺序，样式克制 | ✅ 已实现 |
| R7 | **重点问题**：拿不到单据元数据/字段数据，导致无法实质分析 | ⚠️ 待解（见 §6） |
| R8 | 数据为 BIP **业务审批**（采购/报销/付款/合同/招聘等），紧急补丁/上线是参考项目研发场景、**非我方业务** | ✅ 样例已业务化 |
| R9 | 字段获取：方式1（yonclaw 取数增强）+ 方式2（skill 端二次抓取）**都试**再定 | ⏳ 待办 |
| R10 | 部署：**aicockpit 为源 + 同步脚本**（`deploy.mjs` → yonclaw 安装目录，保留 data/） | ✅ 已实现 |

## 3. 列表视觉（5 微调 + 提交人·日期）

基准：codex 精修稿 `docs/design/approval-message-center-v2/refined-default-list.png`。

```
[风险色边框] ● 单据标题                              [行操作: 通过/驳回]
             提交人 · 提交日期                          ← R3 新增 meta 行
             智能tag1  智能tag2  智能tag3  +N
```

- 风险等级统一文案：high=`重要`、medium=`需关注`、low=`建议通过`；视觉继续使用红/橙/绿区分。
- 智能 tag：去前缀直接显示值，最多 3 个 + `+N`；**剔除 `kind='info'` 的元信息标签**（提交人已由 meta 行展示，避免重复）。
- 顶部 tab：全部待办 / 近 7 天已办 / 重要 / 需关注 / 建议通过（带计数）+ 维度/排序图标 + 批量通过。
- 无顶部大指标卡。

## 4. 详情抽屉（5 段，样式克制）

| 段 | 内容 | 字段 |
|----|------|------|
| ① 总体结论 | 建议通过/需关注/建议拒绝（红绿灯） | `conclusion.advice` |
| ② 总体分析 | ~40 字简述 | `overallAnalysis` |
| ③ 单据字段分析 | 多条（字段名+值+结论+严重度） | `fieldAnalysis[]` |
| ④ 业务规则分析 | 多条（规则名+严重度+结论+**依据**+建议），Agent 自主发现 | `ruleAnalysis[]` |
| ⑤ 附件分析 | 附件名+类型+结论+发现项 | `attachmentAnalysis[]` |

严重度色点/标签：risk 红 / warning 橙 / passed 绿。

## 5. 已办智能总结（R4，以数据统计 + 分析为主）

「近 7 天已办」tab 顶部渲染总结卡（`reviewSummary`）：

- **统计**：已处理总数、通过/驳回/退回数、通过率、风险分布（高/中/低）、类型分布、关键指标（通过率等）。
- **分析**：一段数据统计结论文字（如「共处理 78 件，通过率 100%，单据类型以「审批」最多」）。
- **来源**：真实 `inbox.json` 不带 `reviewSummary` 时，由 `normalize.computeReviewSummary(items)` 从已办 items **现算**；后续可由 agent 生成更深入的分析文字替换 `analysis` 字段。

## 6. 重点问题 R7：单据字段缺失 → 分析无实质内容

**现状**（yonclaw 真实数据实证）：

- yonclaw 已落盘 101 项 v3 待办 + 101 个详情（含 5 段 analysis）。
- 列表项有：`title` / `serviceCode` / `serviceName`（准确服务/业务入口名称）/ 兼容 `docType` / `commitUserName`（提交人）/ `submittedAt` / `tenantName` / `webUrl`。
- 详情 `content` 仅有**待办元信息**：发起人 / 租户 / 提交时间 / 状态。
- **缺单据本身的业务字段**：请购单的金额、物料、数量、预算、供应商等 → `fieldAnalysis` 无实质单据内容可分析。

**数据入口**：`webUrl` 指向真实单据（如 `c1.yonyoucloud.com/mdf-node/meta/voucher/pu_applyorder/<id>`），是补字段的钥匙。

**解决方案（R9：两路都试，再定最终）**：

- **方式 1 · yonclaw 取数增强（推荐）**：yonclaw 同步时顺着 `webUrl` 抓单据明细字段（bill/detail），一并落到 `details`，再交 skill 分析。符合「yonclaw 取数」定调，skill 专注处理展示。
- **方式 2 · skill 端二次抓取**：skill 按 `webUrl` / bill-detail API 自抓单据详情（需 BIP 登录凭据/cookie）。

> skill 侧可提供 `fetch-bill-detail` 脚本 + SKILL.md 取数指令，供两种方式复用。`normalize.mjs` 已能直接消费补全字段后的 `content`/`fieldAnalysis`。

## 7. 数据契约（v3）

对齐 [approve-inbox.schema.json](../jsonSchema/approve-inbox.schema.json) 与 `src/types/approve-inbox.ts`。

- `ApproveInboxData`：`businessType` / `summary` / `viewSettings` / `items[]` / `reviewSummary`（R4）。
- `ApproveInboxItem`：`id` / `title` / `serviceCode` / `sourceServiceCode` / `serviceName` / 兼容 `docType` / `riskLevel` / `status` / `submittedAt` / **`submitter`（R3）** / `advice` / `smartTags[]` / `runtimeActions[]` / `observedActions[]`。
- `ApproveInboxDetail`：`conclusion` / `overallAnalysis` / `fieldAnalysis[]` / `ruleAnalysis[]` / `attachmentAnalysis[]` / `source`。
- `ApproveInboxReviewSummary`（R4）：`period` / `total` / `approvedCount` / `rejectedCount` / `returnedCount` / `riskDistribution` / `typeDistribution[]` / `highlights[]` / `analysis`。

**契约适配**（`normalize.mjs`，兼容 yonclaw 真实数据）：
- 提交人：`item.submitter || item.commitUserName`。
- 智能标签：剔除 `kind='info'`。
- 已办总结：`state.reviewSummary || computeReviewSummary(items)`。
- 详情：`detail.analysis`（5 段对象）→ 透传；兼容 5 段 JSON / ```json 围栏 / 旧 Markdown(`[ADVICE:*]`) 三态。
- 详情字段：`richDetail.normalized.fields[].label/displayValue` 是 canonical 展示层；旧 `content.fields` / `billDetail` / `iformData` 只做兼容 fallback。
- 元数据：`richDetail.meta.fields/enums/sections` 保存从 MDF `/mdf-node/meta`、YNF `tplAndMeta`、iForm `billVue.json` 抽取的轻量索引，不保存完整模板大 JSON。
- 动作：`runtimeActions` 保留给前端兼容，语义上是 observed snapshot；真实执行前由 handler/framework `refreshActions()` 刷新，刷新失败或无匹配动作时不调用审批接口。

## 8. 分析能力（agent-runner，5 段结构化）

`scripts/agent-runner.mjs`：`buildAnalysisPrompt(item, detail)` 约束 Agent（`claude -p`）输出 5 段 JSON：

```json
{
  "conclusion": { "advice": "approve|caution|reject", "label": "..." },
  "overallAnalysis": "<40字>",
  "fieldAnalysis": [ { "name", "value", "summary", "severity": "risk|warning|passed" } ],
  "ruleAnalysis":  [ { "ruleName", "severity", "summary", "evidence": "<必填>", "suggestion" } ],
  "attachmentAnalysis": [ { "name", "fileType", "severity", "summary", "findings": [] } ]
}
```

业务规则由 Agent 自主发现（金额超限/付款条款偏离/附件缺失/一致性等），每条必带 evidence；无法判断给 caution。

## 9. 独立运行与 yonclaw 集成

```bash
node web/server.mjs --open        # 启动并自动打开浏览器（端口 3891，可 APPROVE_INBOX_PORT 配）
# 端口占用即复用（yonclaw 可反复调用不报错）；APPROVE_INBOX_DATA 可指向外部 data 目录
```

REST：`GET /`、`GET /api/inbox`、`GET /api/details/:id`、`GET /api/attachments/:id/:file`、`POST /api/sync`、`POST /api/approve`、`POST /api/shutdown`。所有数据经 `normalize.mjs` 转标准数据契约。

驾驶舱补充入口：`GET /widget/`、`GET /widget/manifest.json`、`GET /api/widget/todos?limit=3`、
`POST /api/widget/refresh`、`GET /api/runtime-context`。

yonclaw 安装 skill 后，调用时执行 `node web/server.mjs --open` 单独打开审批页面供用户审批。

## 10. 部署（R10：aicockpit 为源 + 同步脚本）

`aicockpit/skills/iuap-apcom-myapproval` 为唯一源码。`deploy.mjs` 同步 `web/`、`scripts/`、`SKILL.md` 到 yonclaw 各 profile 的 `openclaw/skills/iuap-apcom-myapproval`（**保留目标 data/**）：

```bash
node skills/iuap-apcom-myapproval/deploy.mjs            # 扫描 yonclaw profiles 部署
node skills/iuap-apcom-myapproval/deploy.mjs --dry-run  # 预览
```

生效：`index.html` 刷新即生效；`normalize/server` 改动需 yonclaw 重启 server（下次调用 skill 时重拉）。

## 11. 目录结构（实际）

```
skills/iuap-apcom-myapproval/
├── SKILL.md                  # yonclaw 安装入口（默认动作=打开审批页面）
├── deploy.mjs                # 同步到 yonclaw 安装目录（保留 data/）
├── widget/                   # 驾驶舱智能待办 iframe widget
├── web/
│   ├── server.mjs            # 零依赖 HTTP + REST（--open / EADDRINUSE 复用 / APPROVE_INBOX_DATA）
│   ├── index.html            # 智能待办单页（自带设计 token；列表 5 微调+meta 行、详情 5 段、已办总结）
│   ├── normalize.mjs         # 契约转换层（真实数据/5段JSON/Markdown → v3；computeReviewSummary）
│   ├── normalize.test.mjs    # 单测
│   └── sample-data.mjs       # 业务审批样例（无凭据兜底）
├── scripts/
│   ├── agent-runner.mjs      # claude -p 5 段分析
│   ├── bill-utils.mjs        # 类型检测/附件提取/变更对比
│   ├── md-to-html.mjs        # Markdown/ADVICE 解析
│   └── *.test.mjs
└── data/                     # yonclaw 填充（gitignore）：inbox.json / details/ / attachments/
```

## 12. 现状与验证

- ✅ web 层独立可跑；sample 业务审批兜底；真机截图验证列表 5 微调 + meta 行 + 详情 5 段 + 已办智能总结。
- ✅ 单测：normalize 33+ 例、scripts（bill-utils/md-to-html）44 例。
- ✅ **真实 yonclaw 数据实证**（101 项业务待办）：提交人（commitUserName→submitter）、提交日期、已办总结（78 件统计+分析）、详情 5 段（真实 analysis）全部正确渲染。
- ✅ R7/R9 已闭环：fetch-bill-detail 经 YonClaw 代理抓真实字段（report/detail 链路），enrich-details 串通「抓字段→分析→写回」。
- ⏳ 后续：MF 外部组件集成（external-component-registry）。

## 13. 多套分析结构 + 场景/eval（pdf-approve-inbox-analysis）

> 2026-06-16 实施。L2，product-dev-flow。验收故事 `docs/user-stories/pdf-approve-inbox-analysis.json`。

### 13.1 取数 profile（验证多单据）
`analysis/fetch-profiles.json` 固化各单据取数参数（端点/微服务/serviceCode/extra）。实测：请购单 pu_applyorder(report/detail,yonbip-scm-pu)、入库 st_purinrecord、出差 znbzbx_busistrip 已验证；销售合同 sact_salescontract 结构已知(bill/detail,yonbip-scm-scmmp)；其余 unverified 标注。fetch-bill-detail 先查 profile 命中再走多候选自适应兜底。

### 13.2 分析结构（通用维 + 业务维）
- `analysis/dimensions.js`：7 通用维（金额合规/预算/附件/一致性/权限/重复/时效）。
- `analysis/profiles/*.json`：8 业务 profile + generic 兜底，每个含 commonDimensions + businessRules（带 evidence 要点）+ keyFields + promptHint。
- `analysis/field-dict.json`：英文字段→中文名+维度；`profile-loader.js`：selectProfile + localizeFields。
- `agent-runner.buildAnalysisPrompt(item, detail, opts)`：profile 驱动组装（通用维+业务维+中文化真实字段），无 opts 退回原通用 prompt（向后兼容）。

### 13.3 enrich 闭环
`scripts/enrich-details.mjs`：inbox → 抓字段 → 选 profile/中文化 → 组装 prompt → claude 分析 → 写回 details（content+analysis）。代理端口自动探测；幂等（已分析跳过，--force 重跑）。真机验证：采购单抓 38 字段 + 5 段分析（profile 5 条业务规则逐条带 evidence）。

### 13.4 Eval 框架
- `eval/scenarios/*.json`：16 golden fixture（采购/报销出差/合同/入库/上线/数据申请/文件签署/通用 × 风险/正常），含 input+expect+mock。
- `eval/scorers.mjs`：确定性分维度打分（结构30%+advice30%+规则命中25%+severity15%，门槛0.7）。
- `eval/eval-runner.mjs`：replay(默认离线)/--real(调claude+录制)/--mock 三模式。`eval/recordings/` 存 golden。
- 回归：scorers + eval(mock) 纳入 node:test；review 门禁。真实模式实测 purchase-over-budget 0.925 通过。

### 13.5 验证基线
全 skill 单测 147 绿（含 analysis/eval 新增）；eval mock 17/17 自洽；真实 claude 端到端通。
