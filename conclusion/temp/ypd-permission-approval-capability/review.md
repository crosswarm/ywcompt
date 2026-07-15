# Review

## 结论

- 代码审查：APPROVE，无遗留高、中、低级代码问题。
- 架构复核：WATCH，可作为合并候选；真实租户烟测是发布前置条件。

## 已闭合能力边界

- YPD/YNF：支持通过 `workflow inboxtask get-document` 拉取详情；审批策略保持 `unsupported`。
- MDF/iForm：审批前强制刷新消息中心动作，只执行当前待办明确返回的同意/退回动作。
- 未知框架：保留原始 `observedActions` 供诊断，不生成 `runtimeActions`。
- UI：没有运行时动作或没有执行回调时不展示行、详情和批量审批入口。
- 待办身份：优先使用 `todoId/primaryId` 精确匹配；缺失时才允许非空 `taskId/businessKey` 回退。

## 验证证据

- ycc 定向测试：199/199 通过。
- ycc 完整测试：462/463 通过；唯一失败为既有 Office 附件转换用例，与本功能无关。
- bip-cli workflow：34/34 通过，包构建成功。
- 两仓库 `git diff --check` 通过。
- source、dist 目录和 ZIP 中关键运行时文件逐字节一致，ZIP 未包含测试、eval 或 data 文件。

## 发布前置与后续

1. 用可丢弃测试待办完成 YPD 详情读取、MDF 同意、MDF 退回三项真实租户烟测，并保存 `list-action` 与批量接口结果。
2. 后续抽取统一的 `classifyDocumentFramework()`，消除同步、详情、归一化和执行器之间的判定漂移风险。
3. 若自定义 handler 是正式能力，sync、enrich、executor 应加载同一 registry。
