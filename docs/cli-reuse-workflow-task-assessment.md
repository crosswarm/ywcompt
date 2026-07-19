# workflow task 标准命令复用评估与协调项清单

目标：approve-inbox 尽量复用 CLI 负责人维护的 `workflow task` 标准命令组（todo-list / todo-detail / check / deal / reject / withdraw / batch-approve / batch-reject，见《应用平台cli专项-审批相关cli命令合集》），替代我们自定义的 `workflow inboxtask` 命令，减少自定义命令维护面。

评估基线（2026-07-19，复核更新）：

- bip-cli develop 分支 `bfa79b9`（2026-07-19）已增强 `todo-list`：顶层返回 `currentTenantId`；items 透传 `buttons`、`tenantName`、`mUrl`、`doneStatus`、`commitTsLong`、`source`（新增共享 `current-tenant.ts`，含单测）。此前评估的字段缺口已全部补齐。
- `todo-detail` / `deal` / `reject` 源码自 07-17 评估以来未变；iForm 兼容性疑问已解除——CLI 负责人确认 deal/reject/withdraw 自动兼容 iForm 表单审批（见第二节结论）。
- **本地构建不可用于真实环境**：本地 `pnpm build` 产物未内嵌构建期 routeSignature，且运行时签名被编译期关闭（api-gateway-proxy.ts:791），所有走 API 网关路由的命令（新旧都算）直接抛"缺少构建期 routeSignature"。可用构建只能出自打标签触发的发布流水线（commit 信息含【本地编译和测试通过申请发布CLI】）。
- 真机实测数据来自市场分发的运行时 CLI 15.13.20 + 宿主 YonClaw 代理（见文末实测记录）。
- 自定义命令现状见 [approve-inbox-cli-command-list.md](approve-inbox-cli-command-list.md)。

## 一、复用结论总表（2026-07-19 修订）

| approve-inbox 触点 | 现用命令 | 标准命令 | 结论 |
| --- | --- | --- | --- |
| 待办同步 + 身份校验探针 | `inboxtask list-inbox` | `task todo-list` | **废弃**：字段缺口经 `bfa79b9` 全部补齐，且 items 新增 `source`/`processInstanceId`（未来 deal/reject 的必填参数就绪）。pageSize 仍 ≤100，同步改 pageNo 分页循环；收件时间无 workflowTaskCreateTime，降级用消息中心时间近似（received-at.mjs 既有降级链） |
| 审批前动作闸门 | `inboxtask list-action` | `task todo-detail` | **废弃**：真机实测语义完全对齐——引擎路由返回完整 availableActions/actionAvailability（含可退回指定环节），退回制单件正确降级为仅支持忽略。耗时实测 15–19s/条（含重型 document 解析），闸门单条预算由 15s 放宽到 **30s** 容纳；--actions-only 轻量模式为后续优化项 |
| 批量通过/退回（默认写通道） | `task batch-approve` / `task batch-reject` | 同左 | **已在复用标准命令**，保持 |
| iForm 通过/退回 | `inboxtask approve-iform` / `reject-iform` | `task deal`（complete）/ `task reject`（rejectToStart） | **废弃，切引擎通道**：CLI 负责人确认（2026-07-19）deal/reject/withdraw 自动兼容 iForm 表单审批——iForm 内嵌流程即统一 ubpm 引擎、wf_ctr 只是门面，故无需改 deal/reject 源码即原生可用；阶段 B 真机用 iForm 件走一遍作为发布验证步骤（见第三节） |
| 补丁审批 | `inboxtask approve-patch` | `task batch`（快审） | **废弃**（2026-07-19 确认不需要补丁审批特殊链路）：approve-inbox 移除 patch 特判（isPatchItem→patch-save-then-batch 策略删除），补丁件与普通 MDF 同走 batch 通道 |
| 单据详情 | `inboxtask get-document` | `task todo-detail` 的 document | **保留**：缺 YNF 支持与附件下载到目录；中期可评估合并 |
| 智能审核结果 | `inboxtask get-intelligent-result` | 无等价 | **保留** |

**废弃清单（目标态）**：`list-inbox`、`list-action`、`approve-patch`、`approve-iform`、`reject-iform`——7 条自定义命令废 5 条，仅保留 `get-document`、`get-intelligent-result`。bip-cli 仓同步删除废弃命令，但必须按第四节发布顺序执行（CLI 先删会打断市场上现行 approve-inbox）。

## 二、"deal/reject 源码未变" 的含义与影响

"iForm 相关审批动作 workflow task 已兼容"这一说法在代码层面没有对应改动：07-17 至 07-19 期间 task 目录只有 todo-list 被增强，`deal.ts`/`reject.ts` 未变。而这两条命令的机制是：

- `deal`：先判定待办归属；在统一流程引擎里 → 调引擎接口（complete/加签）；不在引擎里 → 降级消息中心快审，**且仅支持同意**（deal.ts:164 `messageCenterQuickAction`）。
- `reject`：只有流程引擎一条路（需 processInstanceId，reject.ts:121），**没有消息中心降级**——不在引擎里的待办退不了。

**结论（2026-07-19，CLI 负责人确认）**：上述两种可能中的 ① 成立——deal/reject/withdraw **自动兼容 iForm 表单审批**。技术上自洽：iForm 待办的 webUrl 本就携带 processDefinitionId/processInstanceId/activityId 等统一 ubpm 引擎标识，iForm 内嵌流程即跑在统一引擎上，`wf_ctr/audit`、`wf_ctr/doAction` 只是 iForm 自己的门面接口——deal/reject 直连引擎 openapi 天然覆盖 iForm 待办，无需改 deal.ts/reject.ts，与"源码未变"不矛盾。

## 三、iForm 写通道方案（已定）

- iForm 件审批通过 → `workflow task deal --action complete --source <item.source> --message <意见>`；退回 → `workflow task reject --action rejectToStart --process-instance-id <item.processInstanceId> --source <item.source> --reason <意见>`。source/processInstanceId 由切换后的 todo-list 同步字段提供（bfa79b9 已透传）。
- 被退回制单的 iForm 件不在引擎（todo-detail 降级为仅支持忽略），闸门会拦住，不会误走 deal/reject——语义自洽。
- **发布验证步骤（阶段 B）**：真机用一条真实 iForm 待办完整走一遍通过与退回，确认引擎通道实际生效后再发布。若验证意外不通过，兜底方案是把 `wf_ctr` 审批逻辑合并进标准 deal/reject 作为 iForm 路由（我们有 bip-cli 提交+打标签自助发布权限），改造后照废两条自定义命令。

## 四、发布顺序（bip-cli 作废不可先行）

约束：市场上现行 approve-inbox 仍在调 inboxtask 命令；CLI 若先删命令，旧技能的能力门禁（assertRequiredBipCliCapabilities）会判 CLI 不兼容导致整体不可用。

1. **阶段 A**：bip-cli 打标签发布含 `bfa79b9` 的版本（inboxtask 命令暂全保留；deal/reject 无需任何改动）。
2. **阶段 B**：approve-inbox 完成切换并发布（改动清单见第五节），真机验证通过。
3. **阶段 C**：确认市场 approve-inbox 已更新后，bip-cli 删除 5 条废弃命令（`list-inbox`、`list-action`、`approve-iform`、`reject-iform`、`approve-patch`）及其注册与网关路由，保留 `get-document`、`get-intelligent-result`，打标签再发一版。

## 五、approve-inbox 切换改动清单（阶段 B 执行）

> **进度（2026-07-19 晚）**：下列 1–5 项代码与测试已全部落地（全量回归通过；dist 与真机同步待阶段 A 的 CLI 市场分发后再做）；阶段 A 的 bip-cli 构建+测试已全绿，发布触发提交待推送。

1. 同步与身份探针：`sync-inbox.mjs`/`runtime-identity.mjs` 从 `list-inbox` 切 `todo-list`（pageNo 循环拉全量；currentTenantId 断言不变；buttons→observedActions、tenantName/mUrl/doneStatus/commitTsLong 映射对齐；source/processInstanceId/activityId 落入 state 备 deal/reject 使用）。
2. 审批闸门：`approval-executor.mjs` 刷新从 `list-action` 切 `todo-detail --task-id`，availableActions 映射 complete→approve、reject→return，route/degraded 原因透传到 needs_review 提示；单条预算 15s→30s；快照回退（runtimeActions∪observedActions）与 STRICT 开关语义保持。
3. iForm 写通道：切 `deal`（complete）/`reject`（rejectToStart）引擎通道（第三节），删除 iform-audit 传输分支；真机 iForm 件通过+退回各走一遍作为发布验证。
4. 补丁件：删除 patch 特判与 `approve-patch` 调用，补丁件随 batch 通道。
5. 能力门禁与测试：`bip-cli-client.mjs` REQUIRED 列表更新（去掉 5 条废弃命令，加入 `workflow task todo-list`/`todo-detail`/`deal`/`reject`）；server-approve / server-identity 测试的 fake CLI 增加对应命令与新字段；pack-skill 门禁清单同步。
6. 文档：本文件与 [approve-inbox-cli-command-list.md](approve-inbox-cli-command-list.md) 标注废弃命令及替代关系。

## 六、后续增强机会（切换完成后）

- `check --type reject` + `reject --action rejectToActivity`：退回指定环节（todo-detail 实测已返回"可退回开立人；可退回指定环节"能力位）。
- `deal` 加签/`--assign-info` 指派、`withdraw` 撤回：approve-inbox 新能力候选（同步切 todo-list 后 source/processInstanceId 已在手）。
- todo-detail `--actions-only` 轻量模式：落地后闸门预算可从 30s 收回 15s。
- todo-list 收件时间字段（workflowTaskCreateTime 等价）：落地后收件时间恢复精确语义。

## 七、实测记录（2026-07-19，运行时 CLI 15.13.20 + YonClaw 代理）

| 命令 | 单据 | 结果 | 耗时 |
| --- | --- | --- | --- |
| `task todo-detail` | 通用报销单（MDF，引擎待办） | route=workflow-engine；availableActions=[complete, reject, counterSignAdd, counterSignAfterAdd, withdraw]；reject reason=可退回开立人/可退回指定环节；task.source=RBSM、含 processInstanceId | 18.9s |
| `task todo-detail` | 退回制单待办（buttons 空） | route=message-center-fallback；availableActions=[]；complete/reject 均 degraded=仅支持忽略——与 approve-inbox 退回件语义一致 | 15.1s |
| `inboxtask list-action` | 同上通用报销单 | actions=[approve, return]（对照组） | 5.7s |
| `inboxtask list-inbox` | 全量 50 条 | currentTenantId 正常返回；当前收件箱无 iForm/补丁件（iForm 归属无法现网实测） | — |
| 本地构建 bip-cli.js | 任意网关路由命令 | 抛"API 网关路由 … 缺少构建期 routeSignature"（新旧命令均不可用） | — |
