# 设计

## 身份与认证

- 生产模式固定为 `managed-yonwork`；CLI 只从当前 Profile sibling skill 解析。
- 服务启动必须显式获得托管代理环境，并通过 `whoami -> list-inbox -> whoami` 才可标记 ready。
- 首次 401 仅重建 CLI 调用上下文并重试一次；仍失败则返回 `AUTH_REQUIRED_IN_YONWORK`，不回退本地登录。

## 服务与数据

- 3891 服务公开脱敏的 service identity；Profile/认证上下文不一致时只对已验证的本 skill 实例做受控交接。
- 数据按 `profileKey/userKey/tenantKey/dataScopeKey` 四层隔离；身份键均使用 SHA-256，环境参与 `dataScopeKey`，历史共享数据隔离到 `legacy-v1`。
- 每个 scope 写入仅含哈希身份键与 `identityEpoch` 的 `identity.json`；不落盘明文用户、租户、Profile 路径或托管代理地址。
- 同步写入带 `scopeKey/snapshotId/identityEpoch`，身份变化或认证失败不写盘。

## API 与界面

- 所有业务 API 统一验证当前身份；认证未知、身份不匹配时不读取列表、详情、附件、配置或分析缓存。
- 详情、附件和 enrich 结果同时绑定当前 `scopeKey + snapshotId`；旧快照资源不可读取，也不可参与审批通道判断。
- 旧快照详情按安全缓存未命中处理：只返回由当前 inbox item 生成的 `dataSource=real, enriched=false` 骨架并触发 enrich；不得返回旧字段、旧分析或旧附件。enrich 暂存区在执行前删除所有非当前快照详情，避免失败路径把旧内容重新合并回来。
- 审批建立不可变任务签名，覆盖 `primaryId/taskId/tenantKey/webUrl/businessKey/serviceCode`；初始审批和每个危险 CLI 命令前均与最新 `list-inbox` 精确比对。
- 危险命令结果分为 `confirmed_committed`、`confirmed_failed` 和 `unknown`；无法确认时禁止重复提交并强制刷新对账。
- CLI 参数严格以当前 Profile 的命令 schema/help 为准，不注入未声明的确认参数；能力缺失、路径错误、进程未启动或参数解析拒绝统一判定为 `confirmed_failed`，不得伪装成远端结果未知。
- 响应增加结构化 `issue/identity/cache/analysis`；保留一周期顶层 `error` 兼容字段。
- 前端认证错误立即清空历史状态，并按 `issue.userMessage -> sync.issue.userMessage -> sync.message -> error` 展示。
- `STALE_DETAIL_SNAPSHOT`、`STALE_ATTACHMENT_SNAPSHOT` 和 `LIST_SNAPSHOT_CHANGED` 属于资源快照问题，不得映射为身份切换或清空当前列表。

## 平台原子性边界

- 仓库层执行 `pre-guard -> dangerous CLI -> post-guard`，并在 pre-guard 重新验证 scope、任务存在性和任务签名。
- 严格原子保证需要 req-proxy 在同一次 dispatch 内校验并消费绑定 Profile、用户、租户、authEpoch、请求体哈希与任务签名的一次性 lease；当前平台未提供该能力。
