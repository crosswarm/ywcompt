# Brief: detail-rich-actions

Status: implemented
Created: 2026-06-26

## 原始想法

> 学习参考项目 docs，特别是 meta 和 action 的处理方式，并把启发落到当前 approve-inbox。

## 动机

当前实现已经有 `richDetail` 雏形，但 schema/docs 未完整固化；MDF/iForm metadata 抽取偏浅；审批动作仍容易被理解成可长期信任的静态按钮。

## 目标

- 把 `raw + meta + normalized` 详情富模型确立为稳定中间层。
- 将 `runtimeActions` 明确为 observed action snapshot。
- 真实审批执行前刷新动作，刷新失败或动作不可用时阻断。
- 让 handler 声明审批策略，减少 executor 中的业务分支。

## 非目标

- 本轮不上 SQLite。
- 本轮不开放 YNF 真实写回。
- 本轮不保存完整模板大 JSON。
