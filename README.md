# ycc-approve-inbox · 审批消息中心（YonClaw skill）

从 `aicockpit` 抽出的独立仓库，后续在此维护，不再在 aicockpit 内迭代。

审批消息中心 v3：YonClaw 上的「待办审批收件箱」skill —— 同步待办 → 抓真实单据字段/附件 → AI 分析（结构化 5 段）→ 独立页面查看并审批。

## 目录结构

```
skills/approve-inbox/     ← 核心：独立 YonClaw skill（源码 + 单测 + eval + 打包/部署脚本）
  ├── SKILL.md            技能说明（触发词、能力、架构）
  ├── web/                server.mjs（零依赖 HTTP 服务）+ index.html + normalize + sample-data
  ├── widget/             驾驶舱智能待办 iframe widget（manifest + 静态页）
  ├── scripts/            sync-inbox（拉待办）/ enrich-details（抓字段+分析）/ fetch-bill-detail /
  │                       agent-runner（模型调用）/ runtime-context / bill-utils / md-to-html
  ├── analysis/           分析套路：dimensions（通用维）/ profiles（业务维）/ field-dict / profile-loader
  ├── eval/               评测框架 + 场景（开发用）
  ├── deploy.mjs          同步源码 → YonClaw 安装副本（开发用）
  └── pack-skill.mjs      产出纯净可分发 skill（dist/）
src/                      ← 驾驶舱内嵌 React 组件（ApproveInbox{Shell,Detail,Widget} + 类型，参考用，
                            依赖宿主 cockpit 类型，单独不可构建；集成层胶水未搬）
docs/                     ← spec / jsonSchema 数据契约 / user-story
tests/                    ← 生成测试
```

## 快速开始（独立 skill）

```bash
# 单测（零依赖 node:test）
node --test skills/approve-inbox/**/*.test.mjs

# 本地起服务（无真实数据时回退样例数据）
node skills/approve-inbox/web/server.mjs      # http://localhost:3891

# 驾驶舱智能待办 widget
open http://localhost:3891/widget/
node skills/approve-inbox/scripts/runtime-context.mjs --format json

# 同步真实待办（需 YonClaw 运行，自动探测本机 BIP 代理）
node skills/approve-inbox/scripts/sync-inbox.mjs --data <data目录>

# 产出纯净可分发包（剔除 test/eval/deploy 等）
node skills/approve-inbox/pack-skill.mjs       # → dist/approve-inbox + dist/approve-inbox-skill.tgz
```

## 关键设计

- **取数**：经 YonClaw 本机 BIP 代理（端口动态，自动探测，凭据自动注入，无需 cookie）。待办列表走
  messagecenter todo API；单据详情走 report/detail（getbillcommands 定权威端点）。
- **驾驶舱 widget**：skill 内自包含 `widget/`，由 `GET /widget/manifest.json` 供驾驶舱发现并以 iframe
  加载。widget 只展示少量待办预览和入口，不直接审批；大标题和刷新按钮由驾驶舱标题栏提供，
  驾驶舱可调用 manifest 中的 `refreshUrl` 做轻量刷新；抽屉内完整列表使用
  `/?embed=cockpit-drawer&detailOwner=host`，详情由驾驶舱容器承载。
- **运行时路径感知**：`scripts/runtime-context.mjs --format json` 给 YonClaw/驾驶舱服务读取
  `skillDir/dataDir/profileDir/runtimeDir/openclawDir` 与本机页面 URL；HTTP `GET /api/runtime-context`
  默认只返回安全 URL，不泄露本地绝对路径。
- **跨租户**：待办跨租户聚合，但代理 token 锁单租户 → 他租户单据取数会「数据未找到」；已做检测/标注/
  「仅看当前租户」开关 + 跳过，详情提示「需在 YonBIP 切换租户」。
- **AI 分析后端**：默认走用友底层模型 `deepseek-v4-flash`（`127.0.0.1:3211/api/open-platform-model/v1`，
  OpenAI 兼容、本地直连无需 token，~2-3s/单），失败兜底本地 `claude -p`。env `APPROVE_INBOX_AGENT_PROVIDER` 可切。

## 安装到 YonClaw

```bash
node skills/approve-inbox/pack-skill.mjs
# 解压 dist/approve-inbox-skill.tgz 得 approve-inbox/，放入
# <profile>/userData/runtime/openclaw/skills/
```

## 来源

2026-06-17 从 `aicockpit`（ai-workbench / qiang2 分支）抽出。aicockpit 内的副本与驾驶舱集成接线
（BusinessWidget 派发等）暂保留，集成问题后续单独处理。
