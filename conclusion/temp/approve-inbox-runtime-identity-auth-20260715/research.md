# 调研结论

- 当前 3891 服务是脱离 YonWork Profile 的常驻进程；仅按端口探活会错误复用旧 Profile 服务。
- 当前服务能定位 Profile 内的 `bip-cli.js`，但服务环境缺少 `YONCLAW_REQ_PROXY_BASE_URL`，CLI 因而回退到本机全局凭证并返回 401。
- `data/inbox.json` 是仓库级共享状态，未绑定 Profile、用户或租户；同步失败时服务仍会返回历史数据。
- 前端刷新逻辑没有优先读取 `sync.message`/结构化 issue，真实 401 被替换为“刷新未启动”。
- 修复必须同时覆盖托管认证、Profile 服务交接、用户租户数据域、API 守卫和前端失败状态。
- 当前 sibling CLI 与 YonWork req-proxy 没有 `expected user/tenant/scope`、任务版本或一次性 lease 契约；审批命令前后身份探测能缩小切换窗口，但无法让身份校验和危险请求成为同一个原子操作。
- 审批正确性还要求比对最新待办的 `primaryId/taskId/tenantId/webUrl/businessKey/serviceCode`，不能只判断同一个 ID 是否仍存在。
- 当前 Profile 的真实 `bip-cli.js workflow task batch-approve --help` 不声明 `--yes`；旧实现却对危险命令强行追加该参数，CLI 会在网络请求前以 `unknown option '--yes'` 退出。服务又将所有危险命令抛错统一标记为远端结果未知，形成截图中的错误提示。
- 详情打开后误报“账号或租户已切换”的直接原因不是身份变化：每轮同步都会生成新 `snapshotId`，而旧详情文件仍绑定上一个快照；服务把 `STALE_DETAIL_SNAPSHOT` 错分为 identity，前端随后清空了整个页面。
- 旧详情不能直接重绑到新快照，因为业务字段和附件可能已变化；正确策略是把旧详情当缓存未命中，返回当前列表项的安全骨架并触发当前快照的 `get-document`，旧附件继续拒绝访问。
- repo checkout 启动时 `runtime-context` 曾忽略显式 `APPROVE_INBOX_PROFILE_DIR`，导致服务交接后找不到当前 Profile sibling CLI；现已将显式 Profile 作为运行上下文的一等绑定输入。
- 真实 `workflow inboxtask get-document` 已验证：报销单通过当前 Profile 的 `bip-cli.js` 返回 285 个字段；部分通用工单仍由 sibling CLI 上游 `loadExtend` 因无法解析 `domainKey=yonbip-mid-sscpf` 的 `appServer` 而无法抓取字段，这不是 401 或身份隔离问题。
