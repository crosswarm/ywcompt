# UE v15.13.0-20260715 合并记录

## 合并边界

- 视觉、布局、控件形态、操作位置和响应式行为以 UE 包运行态为准。
- 身份、租户、同步、列表时间语义、详情与附件快照、审批执行和未知结果对账以 `main@b614b14cd755860cd80832f58ff2c60f549890b9` 为准。
- 禁止整包覆盖；UE 包中的旧服务、旧配置、旧脚本、自动打开行为和预览待办不进入正式源码。
- 未经额外业务授权不执行真实审批动作。

## 输入清单

- ZIP：`/Users/cross/Downloads/iuap-apcom-myapproval-v15.13.0-20260715.zip`
- SHA-256：`5bc9785feeff4de1e4cae4138a516862b1375038c03d47c7c6755a556034c82b`
- ZIP 条目：86；文件：74。
- 安全检查：ZIP 完整性通过；未发现路径穿越、符号链接、`.git`、`node_modules`、构建目录或明显密钥文件。
- 基线：`main@b614b14cd755860cd80832f58ff2c60f549890b9`
- 合并分支：`codex/merge-ue-v15.13.0-20260715`
- 合并前标签：`pre-ue-v15.13.0-20260715-b614b14`

### UE 增量判定

采用候选：

- `web/message-list-render.js`
- `web/message-list.css`
- `web/native-table-runtime.test.mjs` 中可适配到当前契约的交互断言
- `web/index.html` 中的消息中心列表、两级页签、风险下拉、批量工具栏、详情头部、移动抽屉、字段展开和 Tinper 风格弹窗
- `web/server.mjs` 中对上述两个静态资源的显式白名单路由

拒绝导入：

- `web/preview-todos.mjs` 与 `web/preview-todos.test.mjs`：仅用于仓库外视觉基准。
- UE 包中的旧 `server.mjs`、旧同步/详情/审批逻辑：会回退当前身份、快照和审批安全语义。
- UE 包中的旧 `scripts/`、配置和 `SKILL.md` 自动打开行为：不属于 UE 视觉增量。

## Product Design 基准

Product Design 用户上下文预检结果为空；本次只使用 ZIP 运行态、当前源码和实时页面作为依据。UE 预览在仓库外以 `APPROVE_INBOX_AUTH_MODE=local-dev` 和 `APPROVE_INBOX_PREVIEW_TODOS=1` 运行。截图前均确认页面 `readyState=complete`、无可见加载遮挡；四个代表页面的控制台错误和警告均为 0。

| 文件 | 视口 / 状态 | SHA-256 |
| --- | --- | --- |
| `design-source/01-desktop-light-list.png` | 1440×900，浅色默认列表 | `1dcb14585611360b32a5ba51655a285181b1113500ed238c29279f5fdd643e88` |
| `design-source/02-desktop-dark-list.png` | 1440×900，暗色默认列表 | `d6b433eec411477b80084733b4ff875797a7d88e2eca77a349eca771d849613a` |
| `design-source/03-desktop-risk-filter.png` | 1440×900，风险筛选展开 | `f0de88c6e594bdffe9f41cadef0b839f4b68554c4d1f9d8fad0e2b6ba4343ef1` |
| `design-source/04-desktop-detail-loading.png` | 1440×900，详情加载 | `de123abf6b7e2a3dd7eaaff4b06031dca1571ca22bb80adb05db44f2db0333d8` |
| `design-source/05-desktop-detail-complete.png` | 1440×900，详情完成 | `1b2a45d96e1066b7e85ffe6b865baae3c0502ed9cd448674c1c0c6580267b3cb` |
| `design-source/06-mobile-list.png` | 390×844，移动列表 | `2fcec6b985f495fbb57597466bbde6a94fda3501fc00f4af2a780d7aef6d077e` |
| `design-source/07-mobile-detail.png` | 390×844，移动详情 | `5fb6a43b01e4b81a558f325f621ce6dee48fe8d1b850fd57492f4debec5c0d90` |
| `design-source/08-desktop-return-dialog.png` | 1440×900，退回弹窗 | `dc9b11dcb5f7bd3279fa7687b0d0ec619953c6df22e2d82fa237ae2946d85ba5` |
| `design-source/09-desktop-multiselect.png` | 1440×900，两条已选与批量操作 | `63a20f580f94c37bef9a52a49e6dada596d2f00abbde86f03f75530e0d8e6f7c` |
| `design-source/10-cockpit-drawer-detail.png` | 1440×900，`embed=cockpit-drawer` 详情 | `e2001ac8d332a7f52f6c47890f6cb1c7d8c9155da79305351ebe8ac3e179e1d0` |

多选和详情加载截图使用 UE 预览页自身的 `state` 与 `render()` 进入可复现视觉状态；未调用接口、未改动仓库源码、未执行审批，采集后关闭临时页面。

## Product Design 审计

### 布局与密度

- 桌面采用消息中心工作台结构：顶部一级页签与检索、第二行类型页签与风险下拉、AI 速览、批量工具栏、紧凑消息列表。
- 列表行以标题和风险标签为第一视觉层，业务类型、提交人、时间为次级元数据，AI 建议与行操作落在第三层。
- 主间距以 4/6/8/12/16 px 为阶梯；小控件圆角 4–6 px，抽屉与弹窗圆角 8–12 px；边界主要使用 1 px 低对比度描边。
- 详情在桌面占右侧抽屉，在移动端覆盖主内容；操作位于详情头部，内容区独立滚动。

### Token 与主题

- 字体继续使用系统字体栈，不引入字体依赖。
- 品牌主色为 `hsl(351 83% 57%)`；链接使用蓝色语义色；AI 点缀使用紫色 token。
- 浅色以白色表面和冷灰背景为主；暗色以 `225 18% 10%` 背景、`222 14% 14%` 表面和低亮描边为主。
- 风险、提醒、通过、信息分别使用 destructive、warning、success、info 语义 token，不能只靠颜色表达，必须同时保留标签文字或图形标记。

### 控件、状态与交互

- 一级、二级页签均须具备选中态；风险筛选使用带当前值和勾选态的下拉菜单。
- 租户开关、全选、行复选框、批量同意、行内同意/退回的位置按 UE；`disabled`、只读和执行结果仍由本地身份、快照与审批能力决定。
- 详情必须包含加载、完成、上下条、关闭、字段展开/收起和独立滚动保持。
- 弹窗采用遮罩、明确标题、说明、表单控件、取消与主操作；焦点和可访问名称必须存在。
- 390 px 下搜索框、两级页签、风险入口和批量工具栏可换行；列表信息分层，不产生横向滚动；详情头部操作保持可达。

### 可访问性验收

- 页签、列表、抽屉、弹窗、开关和复选框保留语义角色与可访问名称。
- 键盘焦点可见，交互热区不因视觉压缩而小于现有 UE 控件。
- 明暗主题下正文、次要文字、边框和风险标签维持可辨认对比度。

## 冲突裁决

| 冲突 | 裁决 |
| --- | --- |
| UE 使用 `submittedAt` 作为列表主时间 | 保留本地 `receivedAt` 作为默认展示与排序时间，`submittedAt` 仅为辅助元数据。 |
| UE 包中的预览待办与旧服务逻辑 | 只在仓库外采集视觉基准，不进入正式源码。 |
| UE 的按钮展示与本地审批可用性 | 位置和形态按 UE；是否可用、执行、失败分类和未知结果对账按本地。 |
| UE 原生列表与本地动态列、规则、Agent 字段计划 | 使用消息中心视觉壳，保留本地字段来源、动态列、个人规则、企业规则、附件和 Agent 字段策略。 |
| UE 详情状态与本地快照恢复 | 使用 UE 抽屉和详情布局，继续保留本地资源快照、陈旧只读和恢复语义。 |

## 实施与验证结果

待后续提交补充：实现文件、测试结果、Product Design 对照、真实 YonWork 验证、分发包哈希、最终提交与标签。
