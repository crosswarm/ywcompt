# UI 规格

- `auth_required`：清空业务内容，提示“YonWork 登录状态已失效，请在 YonWork 中重新登录后刷新”。
- `identity_mismatch`：清空业务内容，提示身份已切换并要求重新刷新。
- `service_context_mismatch`：不展示缓存，提示重新进入智能待办以重建服务。
- `stale_same_identity`：仅在服务端确认同一身份且为非认证故障时展示，只读并标记旧数据时间。
- `empty`：成功同步的空列表，不使用历史缓存替代。
