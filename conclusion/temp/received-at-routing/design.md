# 审批待办到手时间设计

## 目标

把列表和详情中的主时间从“单据提交时间”调整为“任务到手时间”，同时保留提交时间。`receivedAt` 表示当前系统在现有接口能力下能获得的、最接近任务到达用户的时间；它不是审计级的指派事件时间。

## 取值规则

按以下优先级选择第一个合法时间，禁止对多个候选值取 `max()`：

1. `workflowTaskCreateTime`：流程任务实例 `task.createTime`，来源 `workflow.task.createTime`，语义 `task-created`。
2. `createTsLong`：消息中心待办记录创建时间，来源 `message-center.createTsLong`，语义 `message-created`。
3. `createTime`：消息中心创建时间的兼容字段，来源 `message-center.createTime`，语义 `message-created`。
4. `msgTsLong`：消息生成时间，来源 `message-center.msgTsLong`，语义 `message-timestamp`。
5. 全部缺失或非法：`receivedAt = null`，来源与语义均为 `unavailable`。

时间输入兼容毫秒数、数字字符串和 ISO 字符串，统一输出 ISO。`commitTsLong`、`commitTime` 只生成 `submittedAt`；`lastSyncAt`、`syncedAt`、动作 `observedAt` 不参与 `receivedAt`。

## 来源与降级可见性

每条记录同时保存：

- `receivedAt`：ISO 时间或 `null`。
- `receivedAtSource`：精确原始来源枚举。
- `receivedAtSemantics`：`task-created` / `message-created` / `message-timestamp` / `unavailable`。
- `receivedAtSourceLabel`：面向用户的来源说明。

UI 中：

- 流程任务时间显示为“流程任务创建时间”。
- 消息中心创建时间显示为“消息中心待办创建时间（近似）”。
- 消息时间显示为“消息生成时间（弱近似）”。
- 无可靠时间显示“-”，不拿提交时间填充“到手时间”。

详情同时展示“到手时间”“时间来源”“提交时间”。列表默认展示并按到手时间排序；空值排在有值记录之后，不使用提交时间参与到手时间排序。

## 数据获取

增强 `workflow inboxtask list-inbox`：

1. 一次拉取消息中心列表和当前租户。
2. 仅对当前租户任务按 `userId` 去重。
3. 每个不同 assignee 调用一次 `querytaskstodo/page`，按 task id 合并 `task.createTime` 到 `workflowTaskCreateTime`。
4. 跨租户、三方任务或批量查询失败时保留消息中心原始字段，由映射层按上述规则降级。

网络调用数量最多随当前租户不同 assignee 数增长，不随待办条数线性增长；单条详情接口不参与同步。

## 状态保持

同步时以 `taskId` 为身份边界：同一 `taskId` 历史上已经取得更强来源，而本次批量 enrichment 临时失败时，保留历史强来源；新 `taskId` 不继承旧任务时间。来源强度顺序与取值优先级一致。

## 语义边界

`task.createTime` 是任务实例创建时间。转交若产生新 task id，通常会形成新的到手时间；若上游原地修改同一任务实例的 assignee，则它不能证明本次指派时间。审计级“系统何时把任务指派给当前用户”需要 assignment/history event 接口，本次实现不声称覆盖该场景。

## 影响范围

- `bip-cli`：批量 enrichment、纯函数测试和构建产物。
- `ycc-approve-inbox`：数据映射、历史强来源保留、类型/Schema、normalize、列表/卡片/详情配置、React 与静态 Web 展示及排序、测试。
