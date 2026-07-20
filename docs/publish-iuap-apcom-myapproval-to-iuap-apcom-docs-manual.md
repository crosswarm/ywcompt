# 发布 iuap-apcom-myapproval 到 iuap-apcom-docs 手册

本文说明如何把本项目维护的 `iuap-apcom-myapproval` skill 发布到公共 docs 仓库，使它能被 `bip-skills` 发现、安装和更新。

## 目标

- 源项目：`/Volumes/Studio/Studio/ycc-approve-inbox`
- 源 skill：`skills/iuap-apcom-myapproval`
- 目标 docs 仓库：`/Volumes/Studio/iuap-apcom-docs`
- 目标 skill 目录：`/Volumes/Studio/iuap-apcom-docs/skills/iuap-apcom-myapproval`
- 目标分支：`15.13.0`
- skill 分类：`产品`
- 建议提交信息：`chore(skills): update myapproval`

`iuap-apcom-docs` 是发布仓库，不是开发仓库。发布时只同步“纯净可分发 skill”，不要把本项目里的测试、评测、打包脚本、本地运行数据一起发布。

## 发布前检查

在源项目执行：

```bash
cd /Volumes/Studio/Studio/ycc-approve-inbox

git status --short --branch
node --test skills/iuap-apcom-myapproval/**/*.test.mjs
```

确认：

- 待发布改动已经在源项目中完成。
- 测试通过，或明确知道哪些测试因本机环境缺失无法执行。
- `skills/iuap-apcom-myapproval/data/`、`.DS_Store`、临时文件、真实 Cookie/Token/密钥没有进入发布包。
- `SKILL.md` 的触发场景、默认动作、依赖关系和能力边界已经更新。

## 生成纯净发布包

首选使用本项目内置打包脚本：

```bash
cd /Volumes/Studio/Studio/ycc-approve-inbox
node skills/iuap-apcom-myapproval/pack-skill.mjs
```

成功后会生成：

```text
dist/iuap-apcom-myapproval/
dist/iuap-apcom-myapproval.zip
```

打包脚本会剔除：

- `*.test.mjs`
- `eval/`
- `deploy.mjs`
- `pack-skill.mjs`
- `data/`
- `.omc/`
- `node_modules/`
- `.DS_Store`
- `.gitignore`

如果打包脚本因为本机缺少 sibling `iuap-apcom-cli` 能力检查而失败，不要直接发布开发目录。先补齐本机运行时依赖；确需临时处理时，必须手工按上述剔除规则生成一个干净目录，并与 `dist/iuap-apcom-myapproval/` 的预期文件结构一致。

## 同步到 docs 仓库

```bash
export SRC_REPO=/Volumes/Studio/Studio/ycc-approve-inbox
export DOCS_REPO=/Volumes/Studio/iuap-apcom-docs
export SKILL=iuap-apcom-myapproval

cd "$DOCS_REPO"
git status --short --branch
git fetch origin 15.13.0
git switch 15.13.0
git rebase origin/15.13.0

rsync -a --delete \
  --exclude '.DS_Store' \
  "$SRC_REPO/dist/$SKILL/" \
  "$DOCS_REPO/skills/$SKILL/"
```

如果本项目暂时没有 `dist/$SKILL/`，先回到“生成纯净发布包”步骤，不要把开发目录直接 `rsync --delete` 到 docs。

## 更新 docs 索引

在 docs 仓库执行：

```bash
cd /Volumes/Studio/iuap-apcom-docs

python3 skills/scripts/check_skill_index_files.py --skill iuap-apcom-myapproval --fix
node skills/scripts/update_skill_hashes.js
python3 skills/scripts/check_skill_index_files.py --skill iuap-apcom-myapproval
```

`check_skill_index_files.py --fix` 会补充新增文件、刷新 `size` 和时间字段，但它不会自动删除 `files` 中已经不存在的旧条目。如果输出里出现：

```text
文件不存在: <path>
```

需要人工从 `skills/index.json` 的 `iuap-apcom-myapproval.files` 中删除该路径，再重新执行检查。

`update_skill_hashes.js` 可能重写多个 skill 的 hash。发布单个 skill 时，最终提交前应确认 `skills/index.json` 只保留 `iuap-apcom-myapproval` 相关变更。可以用：

```bash
git diff -- skills/index.json
```

目标条目至少应满足：

- `category` 为 `产品`
- `entry` 为 `iuap-apcom-myapproval/SKILL.md`
- `files` 覆盖发布目录下所有运行时文件
- `files` 不包含测试、eval、data、本地缓存或已删除文件
- `size` 由脚本刷新
- `hash` 与 dry-run 输出一致

可用下面命令查看目标条目摘要：

```bash
python3 - <<'PY'
import json
from pathlib import Path

idx = json.loads(Path("skills/index.json").read_text())
s = next(x for x in idx["skills"] if x["name"] == "iuap-apcom-myapproval")
for key in ["name", "category", "maintainer", "hash", "size", "lastUpdatedAt", "firstUploadedAt"]:
    print(f"{key}: {s.get(key)}")
print("files:", len(s.get("files", [])))
PY
```

## 必跑校验

在 docs 仓库执行：

```bash
cd /Volumes/Studio/iuap-apcom-docs

python3 skills/scripts/check_skill_index_files.py --skill iuap-apcom-myapproval
node skills/scripts/update_skill_hashes.js --dry-run | rg "^iuap-apcom-myapproval "

python3 -m json.tool skills/index.json >/tmp/iuap-index.json
find skills/iuap-apcom-myapproval -name '*.json' -type f -print0 \
  | xargs -0 -n 1 python3 -m json.tool >/tmp/myapproval-json-check.out

find skills/iuap-apcom-myapproval -type f \( -name '*.mjs' -o -name '*.js' \) -print0 \
  | xargs -0 -n 1 node --check

node skills/iuap-apcom-myapproval/scripts/config-schema-validator.mjs --name table-view --file skills/iuap-apcom-myapproval/config/table-view.json
node skills/iuap-apcom-myapproval/scripts/config-schema-validator.mjs --name card-view --file skills/iuap-apcom-myapproval/config/card-view.json
node skills/iuap-apcom-myapproval/scripts/config-schema-validator.mjs --name detail-card-view --file skills/iuap-apcom-myapproval/config/detail-card-view.json
node skills/iuap-apcom-myapproval/scripts/config-schema-validator.mjs --name ui-config --file skills/iuap-apcom-myapproval/config/ui.json

node skills/iuap-apcom-myapproval/scripts/ui-config-diagnostics.mjs \
  --config-dir skills/iuap-apcom-myapproval/config \
  --data-dir skills/iuap-apcom-myapproval/data

git diff --check
```

敏感信息扫描：

```bash
rg -n --ignore-case \
  "(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|secret\s*[:=]|password\s*[:=]|token\s*[:=]|cookie\s*[:=]|Authorization:\s*Bearer|BEGIN (RSA|OPENSSH|PRIVATE) KEY)" \
  skills/iuap-apcom-myapproval || true
```

允许出现变量名、环境变量名和运行时随机 token 生成逻辑；不允许出现真实密钥、真实 Cookie、真实 Bearer token。

## bip-skills 验证

先确认本地来源可发现：

```bash
npx bip-skills add /Volumes/Studio/iuap-apcom-docs --list \
  | rg -n "Found|iuap-apcom-myapproval"
```

再用临时 HOME 做安装验证，避免污染当前用户已安装的 skill：

```bash
tmp_home=$(mktemp -d /tmp/myapproval-bip-home.XXXXXX)
tmp_codex=$(mktemp -d /tmp/myapproval-bip-codex.XXXXXX)

HOME="$tmp_home" CODEX_HOME="$tmp_codex" \
  npx bip-skills add /Volumes/Studio/iuap-apcom-docs \
  --skill iuap-apcom-myapproval \
  --yes --global

find "$tmp_home/.agents/skills/iuap-apcom-myapproval" -type f | wc -l
test -f "$tmp_home/.agents/skills/iuap-apcom-myapproval/SKILL.md"
```

如果新增了关键文件，也要明确验证它们已经安装进去，例如：

```bash
test -f "$tmp_home/.agents/skills/iuap-apcom-myapproval/references/schemas/personal-rules.schema.json"
test -f "$tmp_home/.agents/skills/iuap-apcom-myapproval/web/message-list-render.js"
```

`bip-skills update` 只有在目标环境存在可跟踪 lock file 时才有意义。临时 HOME 环境可能提示 `No skills tracked in lock file`，这不代表发布包不可安装；以 `add` 的安装验证为准。

## 提交和推送

确认只包含目标 skill 和 `skills/index.json` 的合理变更：

```bash
cd /Volumes/Studio/iuap-apcom-docs

git status --short --branch
git diff --stat -- skills/index.json skills/iuap-apcom-myapproval
git diff --name-status -- skills/index.json skills/iuap-apcom-myapproval
```

提交：

```bash
git add skills/index.json skills/iuap-apcom-myapproval
git commit -m "chore(skills): update myapproval"
```

提交后再跑一次时间刷新，并 amend 到同一提交：

```bash
python3 skills/scripts/check_skill_index_files.py --skill iuap-apcom-myapproval --fix
git diff -- skills/index.json
```

如果 `--fix` 又改了其他 skill 的 `size` 或 hash，先还原无关条目，只保留 `iuap-apcom-myapproval` 的变更。确认后：

```bash
git add skills/index.json
git commit --amend --no-edit
```

推送：

```bash
git push origin 15.13.0
```

如果 push 被拒绝：

```bash
git fetch origin 15.13.0
git rebase origin/15.13.0
python3 skills/scripts/check_skill_index_files.py --skill iuap-apcom-myapproval
node skills/scripts/update_skill_hashes.js --dry-run | rg "^iuap-apcom-myapproval "
git push origin 15.13.0
```

如果 rebase 冲突在 `skills/index.json`，原则是：保留远端最新全局索引，叠加本次 `iuap-apcom-myapproval` 的描述、files、size、hash、时间字段；不要覆盖远端其他 skill 的更新。

## 发布完成判定

发布完成必须同时满足：

- `git status --short --branch` 显示本地 `15.13.0` 与 `origin/15.13.0` 对齐。
- 最新提交包含 `skills/iuap-apcom-myapproval` 和 `skills/index.json`。
- `check_skill_index_files.py --skill iuap-apcom-myapproval` 通过。
- `update_skill_hashes.js --dry-run` 输出的 myapproval hash 与 `skills/index.json` 一致。
- `bip-skills add /Volumes/Studio/iuap-apcom-docs --skill iuap-apcom-myapproval --yes --global` 在临时 HOME 中可安装。

`feishu-table-monitor` 和 `requirement-revision-guard` 如果仍作为未注册目录出现警告，是之前撤销注册后的预期状态，不要为了消除警告重新注册它们。
