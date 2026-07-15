# Trace

- source of truth: `docs/user-stories/bip-cli-runtime-capability-gate.json`
- design: done
- critique: done，用户明确批准实现方案
- test red: done；先确认缺少能力常量/门禁接口失败，审查补充的相对路径用例也先红后绿
- implement: done；安全绝对 `cwd`、Schema 能力缓存、运行时门禁和打包硬门禁已落地
- review: done；修复相对路径风险并同步受版本控制的 dist/ZIP
- verification: done；智能待办 `node:test` 480/480 通过，新版真实 CLI 检出 326 项能力且满足 10 项要求，临时打包与 `unzip -t` 通过
