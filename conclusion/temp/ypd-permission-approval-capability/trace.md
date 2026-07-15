# Trace

- 2026-07-15 research: done — 核对 YPD Wiki、MDF 文档及两个仓库实现。
- 2026-07-15 design: done — 明确详情恢复、审批能力门控和 MDF 动作链路修复。
- 2026-07-15 critique: done — 用户确认方案并要求开工。
- 2026-07-15 implement: done — YPD 详情链路放行，YPD/未知框架审批失败关闭；MDF/iForm 实时动作刷新、精确待办匹配及 UI 动作门控完成。
- 2026-07-15 review: done — 独立代码审查 APPROVE；架构复核 WATCH，仅保留真实租户烟测、框架分类统一和自定义 handler registry 三项后续工作。
- 2026-07-15 verify: done — ycc 定向测试 199/199；完整套件 462/463（仅既有 Office 转换用例失败）；bip-cli workflow 34/34 且构建成功；source、dist、ZIP 一致。
- 2026-07-15 ship: approved — 用户已确认整理提交并推送；发布前仍须用可丢弃待办完成 YPD 详情、MDF 同意、MDF 退回三项真实烟测。
