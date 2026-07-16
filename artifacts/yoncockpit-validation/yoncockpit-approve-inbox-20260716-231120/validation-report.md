# YonWork 驾驶舱自主验证报告

- 批次：`yoncockpit-approve-inbox-20260716-231120`
- 状态：`diagnosed`
- 执行策略：`repair-on-approval`
- 验证范围：`yonwork-only`
- 排除环境：`yonwork-local-proxy`、`local-debug`
- 范围排除场景：6
- 提示词快照：`9f480bf9d2a1429424f0a3a65b3734fea33e30c2a8185f5e1d9999fad56853b5`
- 功能快照：`3dee2bc4ac24b6f598a9ba4e52b87254d9734de187ca542d8a3513f723785c70`
- 公有云恢复：不适用
- 证据索引：`evidence-index.json` / `evidence-matrix.md`

## 环境进度

| 环境 | 页面构建 | 存储 | Skill 绑定 | 置信度 | 场景进度 |
| --- | --- | --- | --- | --- | --- |
| yonwork-cloud | 未采集 | agent-storage | 已绑定 | unverified | 37/37 |

## 差分归因

| 场景 | 分类 | 责任域 | 诊断组件 | 具备修复资格 |
| --- | --- | --- | --- | --- |
| prompt-1-1-937ffea291 | yonwork-only-skipped | unknown | none | 否 |
| prompt-2-1-8062a46e35 | yonwork-only-skipped | unknown | none | 否 |
| prompt-3-1-0d410d8cf3 | yonwork-only-skipped | unknown | none | 否 |
| prompt-3-2-117451ae03 | yonwork-only-skipped | unknown | none | 否 |
| prompt-4-1-3fccc07f8f | yonwork-only-skipped | unknown | none | 否 |
| prompt-4-2-ef584c8649 | yonwork-only-skipped | unknown | none | 否 |
| 1.1 | yonwork-only-skipped | unknown | none | 否 |
| 1.2 | yonwork-only-skipped | unknown | none | 否 |
| 1.3 | yonwork-only-skipped | unknown | none | 否 |
| 1.4 | yonwork-only-skipped | unknown | none | 否 |
| 1.5 | yonwork-only-skipped | unknown | none | 否 |
| 4.1 | yonwork-only-failed | cockpit | cockpit-page | 否 |
| 4.2 | yonwork-only-failed | cockpit | cockpit-page | 否 |
| 4.3 | yonwork-only-failed | cockpit | cockpit-page | 否 |
| 4.4 | yonwork-only-blocked | unknown | none | 否 |
| 4.5 | yonwork-only-blocked | unknown | none | 否 |
| 4.6 | yonwork-only-passed | unknown | none | 否 |
| 5.1 | yonwork-only-skipped | unknown | none | 否 |
| 5.2 | yonwork-only-skipped | unknown | none | 否 |
| 5.4 | yonwork-only-skipped | unknown | none | 否 |
| 6.1 | yonwork-only-failed | cockpit | cockpit-page | 否 |
| 6.2 | yonwork-only-blocked | unknown | none | 否 |
| 6.3 | yonwork-only-passed | unknown | none | 否 |
| 6.4 | yonwork-only-blocked | unknown | none | 否 |
| 6.5 | yonwork-only-passed | unknown | none | 否 |
| 6.6 | yonwork-only-passed | unknown | none | 否 |
| 6.7 | yonwork-only-skipped | unknown | none | 否 |
| 6.8 | yonwork-only-passed | unknown | none | 否 |
| 7.1 | yonwork-only-skipped | unknown | none | 否 |
| 7.2 | yonwork-only-skipped | unknown | none | 否 |
| 7.3 | yonwork-only-skipped | unknown | none | 否 |
| 7.4 | yonwork-only-skipped | unknown | none | 否 |
| 7.5 | yonwork-only-skipped | unknown | none | 否 |
| 7.6 | yonwork-only-skipped | unknown | none | 否 |
| 7.7 | yonwork-only-skipped | unknown | none | 否 |
| 7.8 | yonwork-only-skipped | unknown | none | 否 |
| 7.9 | yonwork-only-skipped | unknown | none | 否 |

## 下一步

- 等待用户决定并明确授权需要修复的场景
