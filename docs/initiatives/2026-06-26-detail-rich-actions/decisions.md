# Decisions

## D1: runtimeActions as observed snapshot

Date: 2026-06-26

决定：

继续保留 `runtimeActions` 字段名兼容前端，但文档和类型中将其定义为上次观察到的动作快照，并支持 `observedActions` 别名。

原因：

审批动作依赖任务状态、租户、登录态和流程上下文，不能把同步时按钮当作长期可执行事实。

## D2: Handler-owned approval strategy

Date: 2026-06-26

决定：

handler 声明 `approvalStrategy()`，executor 只按策略 kind 调度。

原因：

新增单据或框架时应主要新增/扩展 handler，避免 `/api/approve` 或 executor 继续堆业务分支。
