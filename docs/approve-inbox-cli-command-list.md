# approve-inbox CLI 命令化清单

> 与 `workflow task` 标准命令组的复用评估及给 CLI 负责人的参数需求清单见 [cli-reuse-workflow-task-assessment.md](cli-reuse-workflow-task-assessment.md)。
>
> **2026-07-19 废弃公告**：approve-inbox 已切换到标准 `workflow task` 命令组，本文中 5 条自定义命令**废弃**——`list-inbox`→`task todo-list`、`list-action`→`task todo-detail`、`approve-iform`→`task deal`、`reject-iform`→`task reject`、`approve-patch`→随 `task batch-approve`（补丁特判取消）。仅 `get-document`、`get-intelligent-result` 保留。待市场 approve-inbox 更新后，bip-cli 仓可删除废弃命令（发布顺序见评估文档第四节）。以下明细保留作为接口档案。

本文档列出 approve-inbox 迁移到 `iuap-apcom-cli` 后新增或修改的 CLI 命令、调用说明、入参和底层业务接口。智能待办专属命令统一归入 `workflow inboxtask`，存量批量审批命令继续复用 `workflow task`；approve-inbox 只调用 CLI，不直接调用 YonBIP 业务接口。

## 范围与约束

- 正式调用命令使用 `iuap-apcom-cli`。
- `iuap-apcom-myapproval` 的正式发布依赖 `iuap-apcom-cli` Skill；运行时通过该 Skill 的 `scripts/bip-cli.js` 入口执行命令，不依赖 `bip-cli` 源码仓库。
- `APPROVE_INBOX_BIP_CLI`、`BIP_CLI_PATH`、`IUAP_APCOM_CLI_DIR` 仅用于本地开发、调试和测试路径覆盖，不属于正式发布依赖。
- 复杂 JSON 入参建议通过 `--input -` 传入，避免 shell 转义问题。
- CLI 命令不暴露 `tenantId`、`yTenantId`、`tenantName` 作为入参；租户由当前登录态和统一 HTTP 管线处理。
- 写业务状态命令全部标记 `dangerous: true`，真实执行必须追加 `--yes`。
- 本次迁移不包含 approve-inbox 本地 `/api/*`、页面资源请求、文件预览、本地模型 `127.0.0.1:3211`。

## 命令总表

| 命令 | 状态（2026-07-19） | 指令或修改说明 | CLI 入参 |
| --- | --- | --- | --- |
| `workflow inboxtask list-inbox` | **废弃**→`task todo-list` | 查询审批收件箱待办列表，用于替换 approve-inbox 同步待办直连。 | `pageSize`，默认 `200`，范围 `1..500` |
| `workflow inboxtask get-document` | 保留 | 根据待办 `webUrl` 查询 MDF、iForm、YNF、patch 单据详情，并可下载附件。 | `webUrl`、`taskId?`、`billId?`、`downloadAttachments?`、`outputDir?` |
| `workflow inboxtask list-action` | **废弃**→`task todo-detail` | 审批前刷新消息中心待办按钮快照，返回当前可执行动作。 | `taskId?`、`todoId?`、`webUrl?` |
| `workflow inboxtask approve-iform` | **废弃**→`task deal` | iForm 待办同意。写操作，`dangerous: true`。 | `webUrl`、`comment`、`fieldAssignments?` |
| `workflow inboxtask reject-iform` | **废弃**→`task reject` | iForm 待办退回。写操作，`dangerous: true`。 | `webUrl`、`comment`、`rejectTarget`、`selectedByRejecter` |
| `workflow inboxtask approve-patch` | **废弃**→`task batch-approve` | 补丁审批：读取补丁单详情，保存审批结果，再批量同意待办。写操作，`dangerous: true`。 | `bills`、`comment` |
| `workflow inboxtask get-intelligent-result` | 保留 | 查询审批任务智能审核结果。固定归属 `workflow inboxtask`，不新增 `intelligent-audit` 域。 | `taskId`、`businessKey`、`yhtUserId?` |
| `workflow task batch-approve` | 使用中（标准命令） | 原有批量同意命令补强 `dangerous: true`、gateway route 元数据和测试。 | `primaryIds`、`content?` |
| `workflow task batch-reject` | 使用中（标准命令） | 原有批量退回命令补强 `dangerous: true`、gateway route 元数据和测试。 | `primaryIds`、`content?` |

## 接口与参数明细

### `workflow inboxtask list-inbox`

用途：查询 approve-inbox 待办同步所需的消息中心待办行，同时返回当前登录态租户标识。

调用方式：

```bash
iuap-apcom-cli workflow inboxtask list-inbox --page-size 200
echo '{"pageSize":200}' | iuap-apcom-cli workflow inboxtask list-inbox --input - --format json
```

底层接口：

| 方法 | 接口 | 参数 |
| --- | --- | --- |
| `POST` | `/iuap-apcom-messagecenter/client/mobile/todo/items/PC/query` | query：`appName=pc-client`、`userId=userId`；body：`pageIndex=1`、`pageSize=<input.pageSize>` |
| `GET` | `/iuap-yonbuilder-runtime/bill/generateADT` | query：`domainKey=x`、`terminalType=1`、`billNo=x`、`id=1`；仅用于从 ADT 解析当前登录态租户标识 |
| `POST` | `/iuap-apcom-workflownew/ubpm-web-rest/service/openapi/task/querytaskstodo/page` | body：`assignee=<当前租户待办 userId>`、`returnParticipants=false`、`returnProcessInstance=false`、`start=0`、`size=100000`、`sort=createTime`、`order=desc`；按当前租户 assignee 逐个查询流程引擎任务，把 `createTime` 合并为待办行的 `workflowTaskCreateTime`（收件时间），诊断信息随 `raw.workflowTaskTime` 返回（2026-07-15 `ad248ac` 增补） |

### `workflow inboxtask get-document`

用途：根据审批待办 `webUrl` 获取单据详情，输出 `fields`、`attachments`、`richDetail` 等 approve-inbox 展示数据。

调用方式：

```bash
echo '{"webUrl":"https://...","taskId":"task-1","downloadAttachments":false}' \
  | iuap-apcom-cli workflow inboxtask get-document --input - --format json
```

分流接口：

| 单据类型 | 方法 | 接口 | 参数 |
| --- | --- | --- | --- |
| YNF | `GET` | `/mdf-node/uniform/ypd/bill/generateADT` | query：`domainKey`、`billNo`、`id`、`busiObj`、`from_mc_workflow`、`adt`、`billId`；headers：`Domain-Key` |
| YNF | `POST` | `/iuap-yonbuilder-runtime/ypd/bill/getTplId` | query：`domainKey`、`billId`、`terminalType`、`businessStepCode`、`busiObj`、`from_mc_workflow`、`serviceCode`、`apptype`、`taskId`、`adt`、`url_actual_build_source`、`fragmentId`、`billNo`；body：`billNo`、`businessStepCode`、`tplMode=0`、`detailId`、`terminalType` |
| YNF | `POST` | `/iuap-yonbuilder-runtime/ypd/bill/detail` | query：YNF 公共参数 + `tplid`、`mode=browse`、`datasource=mainEntity`、`billnum`、`id`；body：`alias=mainEntity`、`children=<approvalList/approvalTaskList/bpmStepList>`、`main=true` |
| MDF | `GET` | `/mdf-node/mdf/resource/loadExtend` | query：`domainKey`；headers：`domain-key` |
| MDF | `GET` | `/<appServer>/bill/generateADT` 或 `/<appServerPrefix>/<appServer>/bill/generateADT` | query：透传单据 URL 参数 + `terminalType=1`、`billNo`、`id`；headers：`Domain-Key` |
| MDF | `POST` | `/<appServer>/billmeta/getTplId` 或 `/<appServerPrefix>/<appServer>/billmeta/getTplId` | query：透传单据 URL 参数 + `terminalType=1`、`billnum`；body：`billno`、`terminalType=1`、`id`、`tplmode=0`、`query={apptype:"mdf",taskId}` |
| MDF | `GET` | `/<appServer>/bill/detail` 或 `/<appServerPrefix>/<appServer>/bill/detail` | query：透传单据 URL 参数 + `terminalType=1`、`billnum`、`tplid?`、`id`、`pageDetail=true` |
| iForm | `GET` | `/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData` | query：`_ts`、`_`、`pk_bo`、`pk_boins`、可选 `taskId`、`processDefinitionId`、`processInstanceId`；`tenantId` 仅从 `webUrl` 透传，不作为 CLI 入参 |
| iForm | `GET` | `/yonbip-ec-iform/iform_ctr/rt_ctr/{pkTemp}/billVue.json` | 从 `getFormData` 返回的 `formInfo.data` 提取模板 URL，追加 `_ts` |
| patch | `GET` | `/iuap-yonbuilder-runtime/bill/detail` | query：`terminalType=1`、`busiObj=CJJBDYJZSP`、`fromMessage=1`、`from_mc_workflow=1`、`serviceCode=`、`apptype=mdf`、`businessStepCode=JJBDYJZSP`、`taskId`、`adt=wf`、`billnum=CJJBDYJZSP`、`tplid=2155065408128811043`、`id=billId`、`pageDetail=true`；headers：`Domain-Key=developplatform` |
| MDF 附件列表 | `GET` | `/iuap-apcom-file/rest/fe/file/files` | query：按单据 `objectId`/`serviceCode` 等组装；列出单据挂接附件（2026-07-15 `b146f3a` 增补） |
| MDF 附件签名配置 | `GET` | `/iuap-apcom-file/rest/v1/jssdk/queryConfiguration` | query：`apiHost=<webUrl host>`；获取文件服务签名配置，供下载地址接口签名头使用（2026-07-15 `b146f3a` 增补） |
| MDF 附件下载地址 | `GET` | `/iuap-apcom-file/rest/fe/file/getDownloadUrlWithFileId` | query：`authId=<serviceCode>`、`fileId=<附件 token>`、`fileName=`、`isWaterMark=false`、`fromDevice=web`；headers 带文件签名；把附件 token 换成真实下载地址（2026-07-15 `b146f3a` 增补） |
| 附件下载 | `GET` | 附件 `url` 或 `storagePath` | 仅允许 `/`、`http://`、`https://`、`//` 形式；headers：`Accept=*/*`；响应按二进制写入 `outputDir` |

### `workflow inboxtask list-action`

用途：审批前根据 `todoId`（消息中心 `primaryId`，优先）或 `taskId/businessKey` 刷新按钮快照，返回可执行动作。

调用方式：

```bash
iuap-apcom-cli workflow inboxtask list-action --task-id task-1 --todo-id todo-primary-1
```

底层接口：

| 方法 | 接口 | 参数 |
| --- | --- | --- |
| `POST` | `/iuap-apcom-messagecenter/todocenter/rest/client/web/query/items/list` | body：`pageNo=1..10`、`pageSize=100`、`itemStatus=todo`、`language=zh_CN`、`fieldKeywords=[]`、`sortFiled=createTsLong`、`sortType=desc`；提供 `todoId` 时仅按 `primaryId` 精确匹配，否则按非空 `businessKey === taskId` 匹配 |

动作映射：

| 消息中心按钮字段 | CLI 输出动作 |
| --- | --- |
| `callBackExecType=agree` | `approve` |
| `callBackExecType=reject` | `return` |

### `workflow inboxtask approve-iform`

用途：iForm 待办审批通过。该命令为写操作，真实执行必须带 `--yes`。

调用方式：

```bash
iuap-apcom-cli workflow inboxtask approve-iform --web-url 'https://...' --comment 同意 --yes
```

底层接口：

| 方法 | 接口 | 参数 |
| --- | --- | --- |
| `POST` | `/yonbip-ec-iform/wf_ctr/audit?_ts=<timestamp>` | form body：`taskId`、`processId=<processDefinitionId>`、`comment`；headers：`Content-Type=application/x-www-form-urlencoded;charset=UTF-8` |

说明：`taskId` 和 `processDefinitionId` 从 `webUrl` 解析。`fieldAssignments` 当前仅保留入参位，非空时返回“不支持字段暂存模式”。

### `workflow inboxtask reject-iform`

用途：iForm 待办退回。该命令为写操作，真实执行必须带 `--yes`。

调用方式：

```bash
iuap-apcom-cli workflow inboxtask reject-iform --web-url 'https://...' --comment 信息不完整 --yes
```

底层接口：

| 方法 | 接口 | 参数 |
| --- | --- | --- |
| `POST` | `/yonbip-ec-iform/wf_ctr/doAction?_ts=<timestamp>` | form body：`actionCode=reject`、`pk_workflownote=<taskId>`、`currentActivity=<activityId>`、`processId=<processDefinitionId>`、`docCheck=true`、`taskId`、`pk_bo=<formId>`、`pk_boins=<formInstanceId>`、`comment`、`param=<JSON>` |

`param` JSON：

```json
{
  "processInstanceId": "<processInstanceId>",
  "param_note": "<comment>",
  "param_reject_activity": "<rejectTarget>",
  "selectedByRejecter": "<selectedByRejecter>",
  "rejectSelectedByActivity": ""
}
```

### `workflow inboxtask approve-patch`

用途：补丁审批通过。该命令先保存补丁任务审批单上的审批结果，再批量同意消息中心待办。该命令为写操作，真实执行必须带 `--yes`。

调用方式：

```bash
echo '{"bills":[{"primaryId":"p1","taskId":"t1","billId":"b1"}],"comment":"同意"}' \
  | iuap-apcom-cli workflow inboxtask approve-patch --input - --format json --yes
```

底层接口：

| 步骤 | 方法 | 接口 | 参数 |
| --- | --- | --- | --- |
| 查询补丁单详情 | `GET` | `/iuap-yonbuilder-runtime/bill/detail` | query：`terminalType=1`、`busiObj=CJJBDYJZSP`、`fromMessage=1`、`from_mc_workflow=1`、`serviceCode=`、`apptype=mdf`、`businessStepCode=JJBDYJZSP`、`taskId`、`adt=wf`、`billnum=CJJBDYJZSP`、`tplid=2155065408128811043`、`id=billId`、`pageDetail=true`；headers：`Domain-Key=developplatform` |
| 保存审批结果 | `POST` | `/iuap-yonbuilder-runtime/bill/save` | query：`cmdname=cmdSave`、`businessActName=补丁任务审批单-保存`、`terminalType=1`、`busiObj=CJJBDYJZSP`、`fromMessage=1`、`from_mc_workflow=1`、`serviceCode=`、`apptype=mdf`、`businessStepCode=JJBDYJZSP`、`taskId`、`adt=wf`；body：`billnum=CJJBDYJZSP`、`data=<原单据数据 + shjg2=1 + _status=Update>` |
| 批量同意 | `POST` | `/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action` | body：`primaryIds=<保存成功的 primaryId[]>`、`callBackExecType=agree`、`content=<comment>` |

### `workflow inboxtask get-intelligent-result`

用途：查询审批任务智能审核结果。命令路径固定为 `workflow inboxtask get-intelligent-result`。

调用方式：

```bash
iuap-apcom-cli workflow inboxtask get-intelligent-result --task-id task-1 --business-key biz-1
echo '{"taskId":"task-1","businessKey":"biz-1","yhtUserId":"u1"}' \
  | iuap-apcom-cli workflow inboxtask get-intelligent-result --input - --format json
```

底层接口：

| 方法 | 接口 | 参数 |
| --- | --- | --- |
| `POST` | `/yonbip-mid-sscia/cloudAudit/queryCloudAuditResultDesc` | body：`taskId`、`businessKey`、可选 `yhtUserId` |

注意：API 网关路由模板此前误写为 `/ssc-intelligent-audit/cloudAudit/queryCloudAuditResultDesc`，2026-07-16 `ac76584` 修正为 `/yonbip-mid-sscia/...`（该笔尚在 `codex/develop-qx-smart-audit` 分支，待 MR 合并）。

返回状态归一化：

| 后端返回 | CLI 状态 |
| --- | --- |
| `code=200` 且 `data` 非空 | `success` |
| `displayCode=036-503-010811` | `not_found` |
| `displayCode=036-503-010812` | `disabled` |
| `displayCode=036-503-010813` | `model_error` |
| 其他失败 | `error` |

### `workflow task batch-approve`

用途：批量同意待办。该命令为写操作，真实执行必须带 `--yes`。

调用方式：

```bash
iuap-apcom-cli workflow task batch-approve --primary-ids '["p1","p2"]' --content 同意 --yes
```

底层接口：

| 方法 | 接口 | 参数 |
| --- | --- | --- |
| `POST` | `/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action` | body：`primaryIds=<JSON 数组>`、`callBackExecType=agree`、`content` |

本次修改：补充 `dangerous: true`，补充 `apiGatewayRoute` 元数据，增加注册/危险动作/网关路由测试覆盖。

### `workflow task batch-reject`

用途：批量退回待办。该命令为写操作，真实执行必须带 `--yes`。

调用方式：

```bash
iuap-apcom-cli workflow task batch-reject --primary-ids '["p1","p2"]' --content 不符合要求 --yes
```

底层接口：

| 方法 | 接口 | 参数 |
| --- | --- | --- |
| `POST` | `/iuap-apcom-messagecenter/todocenter/rest/client/patch/batch/async/action` | body：`primaryIds=<JSON 数组>`、`callBackExecType=reject`、`content` |

本次修改：补充 `dangerous: true`，补充 `apiGatewayRoute` 元数据，增加注册/危险动作/网关路由测试覆盖。

## YonClaw / 代理口径

- approve-inbox 侧不再直接判断或拼接 YonBIP 业务端点；所有 YonBIP 业务请求都通过 `iuap-apcom-cli` 命令发起。
- `iuap-apcom-cli` 是本次迁移后的网络边界；是否走 YonClaw 代理或 API Gateway 由 CLI 统一 HTTP 管线和命令注册的 `apiGatewayRoute` 决定。
- 需要继续进入 CLI 统一 HTTP 管线的业务端点包括本文档列出的消息中心、工作流、MDF、iForm、YNF、补丁审批、智能审核接口。
- 不纳入 CLI/YonClaw 迁移范围：approve-inbox 本地 `/api/*`、本地静态资源、浏览器页面资源、文件预览、本地模型 `127.0.0.1:3211`。

## 写操作命令

以下命令必须保持 `dangerous: true`，真实执行必须追加 `--yes`：

- `workflow inboxtask approve-iform`
- `workflow inboxtask reject-iform`
- `workflow inboxtask approve-patch`
- `workflow task batch-approve`
- `workflow task batch-reject`

## approve-inbox 替换关系与调用时机

| approve-inbox 调用点 | CLI 命令 | 调用时机 |
| --- | --- | --- |
| `sync-inbox.mjs` 待办同步 | `workflow inboxtask list-inbox` | 每次待办同步：服务启动首拉、5 分钟定时刷新、手动 `/api/sync`、驾驶舱组件刷新的后台同步、审批后 0/30/90s 对账；另外 `runtime-identity.mjs` 身份校验探针以 `pageSize=1` 调用它验证登录态与数据权限（写请求 forceFresh、读请求走 10s TTL 缓存） |
| `fetch-bill-detail.mjs` / `frameworks/*` 单据详情 | `workflow inboxtask get-document` | 详情补全（enrich）：用户打开待办详情按需触发，或后台调度器批量 AI 分析前取单据字段、富文本与附件 |
| 审批前动作刷新 | `workflow inboxtask list-action` | `approval-executor.mjs` 提交审批前对每条待办刷新可执行动作（闸门，单条 ≤15s；干净空结果时回退同步快照按钮 runtimeActions∪observedActions，`APPROVE_INBOX_ACTION_REFRESH_STRICT=1` 恢复严格闸门） |
| iForm 同意 | `workflow inboxtask approve-iform` | 用户点"通过"且该待办按单据类型被路由为 iForm 链路时 |
| iForm 退回 | `workflow inboxtask reject-iform` | 用户点"退回"且该待办按单据类型被路由为 iForm 链路时 |
| patch 审批通过 | `workflow inboxtask approve-patch` | 用户审批"补丁任务审批单"（CJJBDYJZSP）类待办时，经 `approve-patches.mjs` 委托 |
| 智能审核结果 | `workflow inboxtask get-intelligent-result` | 详情 AI 分析链路（`cloud-audit-result.mjs`）拉取平台智能审核结论与 AI 总结，作为分析摘要输入 |
| 批量同意 / 批量退回 | `workflow task batch-approve` / `workflow task batch-reject` | 默认审批提交通道（消息中心快审/快退）：非 iForm/补丁类待办、以及跨租户三方待办的通过/退回 |

## MR 提交记录（bip-cli 仓）

经 `develop-qx` 分支 MR 合入 `develop`（合并提交 `c469e69`）：

| 日期 | 提交 | 说明 |
| --- | --- | --- |
| 2026-07-08 | `3e287ca` | 新增 7 条 `workflow inboxtask` 命令（list-inbox / get-document / list-action / approve-iform / reject-iform / approve-patch / get-intelligent-result）及共享 HTTP 辅助、网关路由 |
| 2026-07-08 | `1d638a5` | 注册命令 + 注册/危险动作/网关路由测试；`workflow task batch-approve` / `batch-reject` 补 `dangerous: true` 与 `apiGatewayRoute` |
| 2026-07-08 | `6429f49` | 命令组统一改名归入 `workflow inboxtask` |
| 2026-07-15 | `f54706b` | list-action 精确刷新：新增 `todoId` 优先定位 + 修复投影漏 `buttons` 导致 actions 恒为空的缺陷 |
| 2026-07-15 | `b146f3a` | get-document 解析 MDF 附件（file/files + jssdk/queryConfiguration + getDownloadUrlWithFileId 链路） |
| 2026-07-15 | `ad248ac` | list-inbox 增补流程引擎收件时间（workflowTaskCreateTime） |
| 2026-07-16 | `ac76584` | get-intelligent-result 网关路由模板修正（`/ssc-intelligent-audit/...` → `/yonbip-mid-sscia/...`）；**尚在 `codex/develop-qx-smart-audit` 分支，待 MR** |
