# Trace

- research: done
- design: done
- critique: done，用户的明确实施请求通过 Gate
- implement: done
- review: done
- ship: ready for user review，未提交

## 验证目标

- workflow task、消息中心创建时间、消息时间、不可用四级来源均有测试。
- `commitTsLong` 和同步时间不会产生 `receivedAt`。
- 同 task id 的历史强来源可抵抗临时降级；不同 task id 不继承。
- workflow enrichment 调用数按不同 assignee 计，不按待办条数计。
- 列表默认列和排序使用 `receivedAt`；详情保留 `submittedAt` 并显示来源。

## 实现结果

- `bip-cli workflow inboxtask list-inbox` 按当前租户 assignee 去重查询 workflow task，并合并 `workflowTaskCreateTime`；失败不阻断消息中心列表。
- 新增统一解析器，严格执行 workflow task → 消息中心创建 → 消息时间 → unavailable 的优先级。
- `submittedAt` 仅接受明确提交来源，不再回退消息创建/消息时间。
- 同 task id 保留历史强来源，新 task id 不继承。
- 类型、JSON Schema、normalize、列表/卡片/详情配置、React、静态 Web 和驾驶舱投影均已接入。
- 默认按到手时间倒序，缺失/非法值稳定置后；旧 `submitted-*` 排序继续兼容。
- 已更新 SKILL 口径说明并重新生成 `dist/iuap-apcom-myapproval` 与 tgz。

## 验证

- `bip-cli pnpm build`：通过，已同步本地 `skills/iuap-apcom-cli/scripts/bip-cli.js`。
- `bip-cli pnpm test`：145 个测试文件、2819 项全部通过。
- `bip-cli list-inbox --help`：通过。
- approve-inbox 定向 receivedAt/UI/配置/Schema 测试：80 项通过；normalize receivedAt 两分支 2 项通过。
- approve-inbox 全套：439 项中 438 项通过；唯一失败为既有办公附件 DOCX 转 HTML 预览（实际 `<pre>fake-docx</pre>`，期望 `Converted Preview`），与本功能无关。
- `git diff --check`、源码/`dist` 关键文件一致性及打包后 resolver smoke test：通过。

## 已知边界

- `task.createTime` 是任务实例创建时间，不能证明同一 task id 原地改派给当前用户的时刻。
- 审计级最后指派时间仍需上游 assignment/history event。
