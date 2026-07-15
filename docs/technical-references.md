# 审批收件箱技术资料入口

> 最后核验：2026-07-15。两个站点通常需要公司网络与登录态。

## YPD 审批流

- 入口：[YPD 审批流常见问题](https://gfwiki.yyrd.com/pages/viewpage.action?pageId=42396894)
- 适用范围：YPD 提交、撤回、流程回调，以及消息中心待办 `webUrl`、`businessKey`、`todoTemplateVars` 排查。
- 代码术语：当前仓库历史上使用 `ynf` 标识 YPD 框架；`/mdf-node/fragment/` 或 `apptype=ynf` 均按 YPD/YNF 处理。
- 能力边界：该页面未给出供审批收件箱直接调用的通用审批执行 API，因此不能据此开放 YPD 同意或退回。

## MDF

- 入口：[MDF 框架文档](https://bip-test.yonyoucloud.com/iuap-yonbuilder-designer/ucf-wh/docs-mdf/mdf/index.html#/introduce/01-preview)
- 重点章节：VoucherList 流程动作、移动端 ApproveFlow 审批按钮。
- 适用范围：MDF 元数据、单据详情、前端 ViewModel 流程动作和审批按钮显示条件。
- 能力边界：`batchagree`、`batchreject` 是 MDF 前端 ViewModel 动作，不等同于稳定的服务端 HTTP 审批协议。审批收件箱仍通过消息中心动作刷新和既有批量审批命令执行。

## 本项目判定原则

- 框架由实际 `webUrl`、`apptype` 判定，不按“权限申请单”等标题或单一服务编码硬编码。
- 消息中心返回的按钮记录为 `observedActions`，只表示上游观察结果。
- `runtimeActions` 只包含当前应用具备执行策略且宿主已接入执行器的动作。
- 不支持的框架保留详情和诊断信息，但列表、详情和批量入口不显示审批操作。
