# Proposal

Status: implemented

## 推荐方案

- 详情抓取保留兼容字段，同时写入 `richDetail.raw/meta/normalized`。
- MDF/YNF/iForm 只抽取轻量字段 metadata：label、控件类型、枚举、参照、section、权限。
- 前端、搜索、AI prompt 优先使用 `normalized.fields[].label/displayValue`。
- `runtimeActions` 保留名称兼容前端，但语义定义为 observed snapshot。
- handler 提供 `refreshActions()` 和 `approvalStrategy()`；统一 executor 根据策略执行。

## 风险

- 某些历史调用没有 `runtimeActions`。实现保留 `legacy.compat` fallback；真实同步得到空数组时仍阻断。
- YNF action 刷新依赖页面上下文，本轮仍保持 unsupported。

## 验证方式

- 单测覆盖 metadata 抽取、枚举翻译、action refresh 阻断、handler strategy。
- 回归运行 scripts/web 相关 node:test。
