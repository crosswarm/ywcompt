# approve-inbox CLI 命令化清单

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

| 命令 | 修改类型 | 指令或修改说明 | CLI 入参 |
| --- | --- | --- | --- |
| `workflow inboxtask list-inbox` | 新增 | 查询审批收件箱待办列表，用于替换 approve-inbox 同步待办直连。 | `pageSize`，默认 `200`，范围 `1..500` |
| `workflow inboxtask get-document` | 新增 | 根据待办 `webUrl` 查询 MDF、iForm、YNF、patch 单据详情，并可下载附件。 | `webUrl`、`taskId?`、`billId?`、`downloadAttachments?`、`outputDir?` |
| `workflow inboxtask list-action` | 新增 | 审批前刷新消息中心待办按钮快照，返回当前可执行动作。 | `taskId?`、`todoId?`、`webUrl?` |
| `workflow inboxtask approve-iform` | 新增 | iForm 待办同意。写操作，`dangerous: true`。 | `webUrl`、`comment`、`fieldAssignments?` |
| `workflow inboxtask reject-iform` | 新增 | iForm 待办退回。写操作，`dangerous: true`。 | `webUrl`、`comment`、`rejectTarget`、`selectedByRejecter` |
| `workflow inboxtask approve-patch` | 新增 | 补丁审批：读取补丁单详情，保存审批结果，再批量同意待办。写操作，`dangerous: true`。 | `bills`、`comment` |
| `workflow inboxtask get-intelligent-result` | 新增 | 查询审批任务智能审核结果。固定归属 `workflow inboxtask`，不新增 `intelligent-audit` 域。 | `taskId`、`businessKey`、`yhtUserId?` |
| `workflow task batch-approve` | 修改 | 原有批量同意命令补强 `dangerous: true`、gateway route 元数据和测试。 | `primaryIds`、`content?` |
| `workflow task batch-reject` | 修改 | 原有批量退回命令补强 `dangerous: true`、gateway route 元数据和测试。 | `primaryIds`、`content?` |

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
| `POST` | `/ssc-intelligent-audit/cloudAudit/queryCloudAuditResultDesc` | body：`taskId`、`businessKey`、可选 `yhtUserId` |

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

## approve-inbox 替换关系

| approve-inbox 调用点 | CLI 命令 |
| --- | --- |
| `sync-inbox.mjs` 待办同步 | `workflow inboxtask list-inbox` |
| `fetch-bill-detail.mjs` / `frameworks/*` 单据详情 | `workflow inboxtask get-document` |
| 审批前动作刷新 | `workflow inboxtask list-action` |
| iForm 同意 | `workflow inboxtask approve-iform` |
| iForm 退回 | `workflow inboxtask reject-iform` |
| patch 审批通过 | `workflow inboxtask approve-patch` |
| 智能审核结果 | `workflow inboxtask get-intelligent-result` |
| 批量同意 / 批量退回 | `workflow task batch-approve` / `workflow task batch-reject` |
