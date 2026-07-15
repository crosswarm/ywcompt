# Trace

- research: done，已限定为用户指定的官方文档与本地仓库证据
- design: done
- critique: done，用户明确批准完整实施方案
- implement: done
- review: done
- ship: ready for user review，未提交

## 验证目标

- 服务元数据查询失败不阻断同步，且不再把技术编码当作名称。
- `serviceCode` 用作稳定身份，`serviceName` 用作第一显示来源。
- 新旧数据契约兼容，原 `docType` 配置不需要迁移。
- 当前工作区既有到手时间等修改保持不变并继续通过测试。

## 实现结果

- 新增 `service-identity-resolver.mjs`，按原始 `serviceCode` 精确查询 `iuap-apcom-cli auth permission apply`；仅在明确匹配 `transType_` 前缀且精确查询失败时重试后缀。
- 同一原始编码每轮同步只查询一次，最大并发为 4；单项失败或超时不会阻断待办同步。
- `serviceCode` 保持稳定身份，`sourceServiceCode` 只在规范编码与原始编码不同时保留，`serviceName` 成为业务显示第一来源。
- `docType` 保留为兼容显示字段，旧数据缺少 `serviceName` 时继续可用；列表、分组、搜索、规则匹配和驾驶舱投影均优先使用 `serviceName`。
- 更新 schema、用户故事和测试，覆盖 `GZTACT045`、带 `transType_` 前缀编码、未知编码安全兜底及历史已办回填。

## 验证

- `git diff --check`：通过。
- `node --test skills/iuap-apcom-myapproval/**/*.test.mjs`：439 项中 438 项通过；唯一失败为既有 Office 附件 DOCX 转 HTML 预览（实际 `<pre>fake-docx</pre>`，期望 `Converted Preview`），与服务身份解析无关。
- 重新执行 `pack-skill.mjs dist` 后，`dist/iuap-apcom-myapproval` 已包含运行时 `scripts/service-identity-resolver.mjs`。
