#!/usr/bin/env node
/**
 * deploy.mjs — 把 aicockpit 的 approve-inbox skill 同步到 yonclaw 安装目录
 *
 * 设计：aicockpit/skills/approve-inbox 为唯一源码，本脚本将 web/ scripts/ SKILL.md
 * 同步到 yonclaw 各 profile 的 openclaw/skills/approve-inbox（**保留目标 data/**，
 * 因 data/ 由 yonclaw runtime 取数填充）。
 *
 * 用法：
 *   node skills/approve-inbox/deploy.mjs            # 自动扫描 yonclaw profiles 部署
 *   node skills/approve-inbox/deploy.mjs <目标目录>  # 部署到指定目录
 *   node skills/approve-inbox/deploy.mjs --dry-run   # 只打印将要同步的内容
 *
 * 生效说明：index.html 由 server 实时读取，刷新即生效；
 * normalize.mjs / sample-data.mjs / server.mjs 为 import 内容，需重启 yonclaw 的 server 进程生效。
 */

import { cpSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = __dirname; // skills/approve-inbox

// 同步内容（不含 data/，保留目标运行时数据）
const SYNC_ITEMS = ["web", "scripts", "analysis", "eval", "SKILL.md", ".gitignore"];

const profilesDir = join(homedir(), "Library/Application Support/yonclaw/profiles");

/** 扫描 yonclaw 各 profile 下的 approve-inbox 安装目录 */
function findTargets() {
  const targets = [];
  if (!existsSync(profilesDir)) return targets;
  for (const p of readdirSync(profilesDir)) {
    const t = join(profilesDir, p, "userData/runtime/openclaw/skills/approve-inbox");
    if (existsSync(t)) targets.push(t);
  }
  return targets;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const explicit = args.find((a) => !a.startsWith("--"));
const targets = explicit ? [explicit] : findTargets();

if (targets.length === 0) {
  console.error("✗ 未找到 yonclaw 安装目标（openclaw/skills/approve-inbox）。");
  console.error("  可显式指定：node deploy.mjs <目标目录>");
  process.exit(1);
}

// 排除 data/ 与 node_modules
const filter = (src) => !src.includes(`${"/"}data${"/"}`) && !src.endsWith("/data") && !src.includes("node_modules");

for (const dest of targets) {
  console.log(`→ 目标: ${dest}`);
  for (const item of SYNC_ITEMS) {
    const s = join(SRC, item);
    if (!existsSync(s)) continue;
    const d = join(dest, item);
    if (dryRun) {
      console.log(`   [dry-run] ${item}`);
      continue;
    }
    cpSync(s, d, { recursive: true, force: true, filter });
    console.log(`   ✓ ${item}`);
  }
  console.log(`   （已保留目标 data/）`);
}

if (!dryRun) {
  console.log("\n部署完成。index.html 刷新即生效；normalize/server 改动需重启 yonclaw 的 server 进程。");
}
