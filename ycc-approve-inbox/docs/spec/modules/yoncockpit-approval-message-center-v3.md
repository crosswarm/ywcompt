# 模块需求：审批消息中心 v3（approve-inbox）

- 模块标识：`approval-message-center-v3` / skill `approve-inbox`
- 状态：`in_progress`
- 关联：技术细节见 `docs/spec/approve-inbox-component.md`；数据契约 `docs/jsonSchema/approve-inbox.schema.json`；验收故事 `docs/user-stories/pdf-approve-inbox-analysis.json`
- 参考实现：`git.yyrd.com/liujian-research/approve-inbox`（clone 于 `/tmp/approve-inbox-ref`）

---

## 1. 定位与架构

审批消息中心 v3 = 一个**可独立运行的审批助手 skill**（零依赖 Node web 服务 + 单页前端），由 YonClaw 安装、调用时单独打开审批页面。与现有 `MessageCenterWidget`（`approval-message-center`）并存，不替换。

**架构边界（关键）**：

```
YonClaw runtime ──拉取用户待办列表──► data/inbox.json（v3 ApproveInboxData）
                                          │
approve-inbox skill ──处理+展示──► web/server.mjs（REST）+ index.html（单页）
   ├─ 取数：经 YonClaw BIP 代理（动态端口，凭据自动注入）抓单据明细字段
   ├─ 分析：claude -p 按 profile 输出 5 段结构化 JSON
   └─ 离线分析调度：定时对未分析待办自动 enrich（抓字段+分析+附件）

approve-inbox skill ──驾驶舱入口──► widget/（iframe 智能待办预览）
   ├─ manifest：GET /widget/manifest.json
   ├─ 数据：GET /api/widget/todos?limit=3
   ├─ 刷新：POST /api/widget/refresh（由驾驶舱标题栏按钮触发）
   └─ 跳转：GET /?returnTo=<cockpit-url>，支持返回驾驶舱
```

- **待办列表抓取 = YonClaw 职责**（写 `data/inbox.json`）。
- **字段取数 / 分析 / 展示 / 离线分析 = 本 skill 职责**。
- **驾驶舱 widget = 本 skill 自包含资产**，驾驶舱通过 manifest/iframe 加载，不直接耦合 React 组件；
  iframe 内不渲染大标题和刷新按钮，这两项由驾驶舱标题栏提供。

## 2. 列表视图（体验需求）

- **行结构**：风险色边框 + 标题；下一行 meta = 提交人 · 提交时间 · **审批建议 tag**（建议通过/需关注/建议拒绝，绿/琥珀/红软底，tag 感，区别于审批按钮）；再下行智能标签（去前缀，≤3 + `+N`）。
- **审批按钮**：默认隐藏，**hover 行时显示**；通过=用友红主操作、驳回=描边幽灵，主题与 YonClaw 一致。
- **两层 tab**：
  - L1：`待办 | 已办`（带计数）。
  - L2：默认风险维 `全部 | 重要 | 需关注 | 低风险`；**「按类型」一键切换** → L2 变为单据类型维（采购/报销/合同… 动态去重）。
- **每个 tab 顶部 AI 总结**：待办 tab → 待办速览（待办数/风险分布/需关注数/类型分布 + 简短分析）；已办 tab → 已办总结（通过率/驳回/风险分布 + 分析）。两侧均由 `normalize.computeSummary(items, scope)` 现算（数据带 AI 文字时优先）。
- 无顶部大指标卡。

## 3. 详情抽屉（5 段，固定顺序）

① 总体结论（红绿灯）② 总体分析（~40 字）③ 单据字段分析（多条）④ 业务规则分析（多条带 evidence）⑤ 附件分析。样式克制；兜底标注「AI 兜底·仅供参考」。

## 4. 取数（单据字段）

- 入口：列表项 `webUrl`。链路 `uniform getTplId → {微服务}/report|bill/detail`。
- 关键：详情走 **`report/detail`**（多数）或 `bill/detail`（如销售合同）；`id`=webUrl 雪花 id；`serviceCode`=`<billnum>list`。
- 取数参数因单据类型而异，固化在 `skills/approve-inbox/analysis/fetch-profiles.json`（已验证：请购/入库/出差；销售合同结构已知；其余 `unverified`，未命中走多候选自适应兜底）。
- 凭据经 **YonClaw BIP 代理自动注入**（端口动态，运行时用 `lsof` 扫描 YonClaw 监听端口 + 验活探测）。

## 5. 分析（多套通用维 + 业务维）

- `analysis/dimensions.js`：7 通用维（金额合规/预算匹配/附件完整/信息一致性/审批权限/重复提交/时效）。
- `analysis/profiles/*.json`：8 业务 profile（采购/费用出差/合同/入库/上线/数据申请/文件签署/通用审批）+ `generic.json` 兜底；每个含 commonDimensions + businessRules（带 evidence 要点）+ keyFields + promptHint。
- `analysis/field-dict.json`：英文字段 key → 中文名 + 维度；`profile-loader.js`：selectProfile + localizeFields。
- `agent-runner.buildAnalysisPrompt(item, detail, opts)`：profile 驱动；无 opts 退回通用 prompt（向后兼容）。

## 6. 字段→分析闭环 + 附件分析

- `scripts/enrich-details.mjs`：inbox → 抓字段 + 提取/下载附件 → 选 profile / 中文化 → 组装 prompt → claude 分析 → 写回 `details/<id>.json`（content.fields + content.attachments + analysis）。
- 附件：`fetch-bill-detail.extractDetailAttachments` 提取（兼容 JSON 数组字段）+ `downloadAttachments` 经代理下载到 `data/attachments/<id>/`，路径喂 `runAgent({files})`（已支持文本嵌入 + attachmentAnalysis 段）。无附件优雅降级（附件段空）。

## 7. 自动刷新 + 离线分析

- server 调度：`startScheduler()` 定时（默认 5min，`APPROVE_INBOX_AUTO_INTERVAL` 配）对未分析待办自动 enrich（每轮 `APPROVE_INBOX_AUTO_LIMIT` 条，默认 2）；`APPROVE_INBOX_AUTO=0` 关闭。
- `GET /api/sync-status` 返回调度状态；`POST /api/sync` 立即触发一次。
- 前端：30s 轮询 `/api/inbox` 平滑刷新（保留选中详情）+ 10s 轮询状态（顶栏「离线分析中…/已分析 N」指示）。

## 8. Eval 评估

`eval/scenarios/*.json`（16 golden 场景，单据类型 × 风险情形）+ `scorers.mjs`（确定性分维度打分：结构30%+advice30%+规则命中25%+severity15%，门槛 0.7）+ `eval-runner.mjs`（replay/--real/--mock）。回归纳入 `node:test`；review 门禁。

## 9. 部署

`skills/approve-inbox` 为唯一源码。`deploy.mjs` 同步 `web/scripts/analysis/eval/SKILL.md` 到 YonClaw 各 profile 的 `openclaw/skills/approve-inbox`（保留 data/）。

widget 资产同源分发：`deploy.mjs` 同步 `widget/`；`pack-skill.mjs` 默认保留 `widget/` 和
`scripts/runtime-context.mjs`。YonClaw/驾驶舱服务可调用：

```bash
node <skill-dir>/scripts/runtime-context.mjs --format json
```

获取当前 `skillDir/dataDir/profileDir/runtimeDir/openclawDir/serverUrl/widgetUrl/centerUrl`。HTTP
`/api/runtime-context` 默认不暴露本地绝对路径。

## 10. 验收基线

- 单测（node:test 零依赖）全绿：normalize（含双侧总结）/ scorers / profile-loader / fetch-bill-detail（含附件提取）/ eval。
- eval mock 全场景自洽；真实 claude 端到端通（purchase-over-budget 0.925）。
- 真机（server 指向真实 data）：两层 tab + advice tag 同行 + hover 按钮（用友红）+ 每 tab AI 总结；详情 5 段含真实字段；自动刷新/离线分析状态可见。

## 需求编号

| 编号 | 需求 | 状态 |
| --- | --- | --- |
| AMC3-UX1 | 提交人·提交时间同行 | done |
| AMC3-UX2 | 审批建议 tag 同行（区别于按钮） | done |
| AMC3-UX3 | 审批按钮 hover 显示 + 用友红主题 | done |
| AMC3-UX4 | 两层 tab（待办/已办 × 风险/类型切换） | done |
| AMC3-UX5 | 每个 tab 顶部 AI 总结 | done |
| AMC3-F1 | 自动刷新 + 离线分析（调度 + 轮询） | done |
| AMC3-F2 | 附件分析（提取/下载/喂分析） | done（真实带附件单据待样本验证）|
| AMC3-F3 | 模块文档归位 docs/spec/modules | done |
