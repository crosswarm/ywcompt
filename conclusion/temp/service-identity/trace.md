# Trace

- research: done，已限定为用户指定的官方文档与本地仓库证据
- design: done
- critique: done，用户明确批准完整实施方案
- implement: done
- review: done
- ship: ready，源码与交付目录已同步

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
- 历史服务身份在本轮元数据查询失败时保持已有的规范 `serviceCode/serviceName/sourceServiceCode`，且不会把落盘名称误判为本轮 todo 直出值。
- 仅把可信业务名称当作 `serviceName`；todo 或 CLI 返回与编码相同、明显 code-like 的值时继续解析或降级，避免技术码泄漏。
- 解析范围收敛为当前待办与保留已办；旧的已消失 pending 不再触发查询或计入解析统计。
- 服务身份回填会同步刷新生成型 `displayKey/displayLabel`，并保留显式自定义显示键；兼容 legacy `inbox[]/done[]` 状态迁移。
- 旧数据中的技术码 `serviceName/docTypeName/displayLabel/serviceNameSource` 会原子清理；明显技术标识符会降级，但保留 Salesforce 等合法单词型英文业务名。
- 正式发布依赖改为 `iuap-apcom-cli` Skill，并在 `metadata.yonbip.dependencies.skills` 声明为 required；`bip-cli.js` 路径覆盖只保留给本地开发、调试和测试。
- `serviceNameSource` 与 `meta.serviceResolution.provider` 统一输出 `iuap-apcom-cli.auth.permission.apply`；旧 `bip-cli.auth.permission.apply` 在读时和历史回填时迁移。

## 验证

- `git diff --check`：通过。
- `node --test skills/iuap-apcom-myapproval/**/*.test.mjs`：467/467 通过（包含正式依赖、旧来源迁移和并行合入的 handler 能力收口测试）。
- 重新执行 `pack-skill.mjs` 后，`dist/iuap-apcom-myapproval` 与源目录关键运行时文件逐一 `cmp` 一致；仅生成并刷新 `dist/iuap-apcom-myapproval.zip`，`unzip -tq` 通过且不存在 TGZ 产物。
- `node --check`（服务解析与同步脚本）及 `jq empty docs/jsonSchema/approve-inbox.schema.json`：通过。
