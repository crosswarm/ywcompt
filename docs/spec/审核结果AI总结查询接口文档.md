# 查询审核结果（结果描述 + AI总结）接口文档

## 1. 接口概述

根据 `taskId`、`businessKey`、`yhtUserId` 查询智能审核结果中的**结果描述**和**AI总结**。

> **适用场景**：云审流程中，外部系统或前端需要根据审批任务信息获取审核结论和AI总结内容。

---

## 2. 接口信息

| 项 | 值 |
|----|-----|
| **接口路径** | `/cloudAudit/queryCloudAuditResultDesc` |
| **请求方式** | POST |
| **Content-Type** | application/json |
| **所属服务** | ssc-intelligent-audit |
| **Controller** | `CloudAuditController` |

---

## 3. 请求参数

### 3.1 请求体（CloudAuditQueryResultDTO）

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `taskId` | String | 是 | 审批任务ID，云审流程中的任务标识 |
| `businessKey` | String | 是 | 业务标识，流程实例的唯一业务键 |
| `yhtUserId` | String | 否 | 友户通用户ID，用于精确匹配审核结果 |



### 3.2 请求示例

```json
{
  "taskId": "938f6faf-78e9-11f1-950a-36ad761833c9",
  "businessKey": "ssc_general_work_order_card_2578592656975200261",
  "yhtUserId": "eb1aaab7-f0e8-4ac5-b5fe-9acd59c9f7e2"
}
```

---

## 4. 响应参数

### 4.1 响应结构（AuditResultVO）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| **`resultDesc`** ⭐ | String | **审核结果描述** — 智能审核的结论性描述文本 |
| **`AISummaryResultDesc`** ⭐ | String | **AI审核总结结果描述** — 大模型生成的审核总结内容 |
| `resultId` | String | 审核结果ID |
| `queryId` | String | 审核运行实例ID |



### 4.2 响应示例

#### 成功响应

```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "resultId": "res_001",
    "queryId": "inst_202607070001",
    "resultDesc": "本识别为中风险，请重点核查",
    "AISummaryResultDesc": "经AI审核分析，该报销单存在以下风险：1. 发票金额超出公司差旅标准规定上限；2. 报销事由为\"客户拜访\"但费用类型选择了\"培训费\"，存在分类不一致问题。建议核实后处理。"
  }
}
```

#### 异常响应

```json
{
  "code": 999,
  "message": "未查询到审核结果",
  "data": null,
  "displayCode": "036-503-010704",
  "detailMsg": null,
  "level": 0,
}
```


---

## 5. 错误码

| 错误码 | 说明 |
|--------|------|
| `036-503-010811` | 暂未查询到智能审核结果，建议打开单据人工复核 |
| `036-503-010812` | 未启用AI审核总结参数，请在web端【系统参数】节点启用参数 |
| `036-503-010813` | 大模型执行异常，请联系管理员检查模型配置和流量使用 |
