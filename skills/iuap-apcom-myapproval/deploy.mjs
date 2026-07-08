#!/usr/bin/env node
/**
 * deploy.mjs — 把 aicockpit 的 iuap-apcom-myapproval skill 同步到 YonWork/YonClaw 安装目录
 *
 * 设计：aicockpit/skills/iuap-apcom-myapproval 为唯一源码，本脚本将 web/ widget/ scripts/ SKILL.md
 * 同步到各 profile 的 openclaw/skills/iuap-apcom-myapproval，并兼容旧安装目录
 * {approve-inbox,iuap-apcom-approveinbox}
 * （**保留目标 data/**，因 data/ 由运行时取数填充）。
 *
 * 用法：
 *   node skills/iuap-apcom-myapproval/deploy.mjs            # 自动扫描 YonWork/YonClaw profiles 部署
 *   node skills/iuap-apcom-myapproval/deploy.mjs <目标目录>  # 部署到指定目录
 *   node skills/iuap-apcom-myapproval/deploy.mjs --dry-run   # 只打印将要同步的内容
 *
 * 生效说明：index.html 由 server 实时读取，刷新即生效；
 * normalize.mjs / sample-data.mjs / server.mjs 为 import 内容，需重启运行时的 server 进程生效。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = __dirname; // skills/iuap-apcom-myapproval

// 同步内容（不含 data/，保留目标运行时数据）
const SYNC_ITEMS = ["web", "widget", "scripts", "analysis", "eval", "SKILL.md", ".gitignore"];

const APP_SUPPORT_NAMES = ["yonclaw", "YonWork", "yonwork"];
const TARGET_SKILL_DIR_NAME = "iuap-apcom-myapproval";
const LEGACY_TARGET_SKILL_DIR_NAMES = ["approve-inbox", "iuap-apcom-approveinbox"];
const TARGET_SKILL_DIR_NAMES = [TARGET_SKILL_DIR_NAME, ...LEGACY_TARGET_SKILL_DIR_NAMES];

function profileRoots() {
  const roots = APP_SUPPORT_NAMES.map((name) => join(homedir(), "Library", "Application Support", name, "profiles"));
  return [...new Set(roots)].filter((root) => existsSync(root));
}

/** 扫描 YonWork/YonClaw 各 profile 下的新安装目录，并兼容旧目录迁移 */
function findTargets() {
  const targets = [];
  for (const profilesDir of profileRoots()) {
    for (const p of readdirSync(profilesDir)) {
      const skillsDir = join(profilesDir, p, "userData", "runtime", "openclaw", "skills");
      const profileTargets = [];
      for (const skillDirName of TARGET_SKILL_DIR_NAMES) {
        const t = join(skillsDir, skillDirName);
        if (existsSync(t)) profileTargets.push(t);
      }
      const primary = join(skillsDir, TARGET_SKILL_DIR_NAME);
      const hasLegacy = profileTargets.some((target) => LEGACY_TARGET_SKILL_DIR_NAMES.includes(basename(target)));
      if (!profileTargets.includes(primary) && hasLegacy) {
        targets.push(primary);
      }
      targets.push(...profileTargets);
    }
  }
  return [...new Set(targets)];
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const explicit = args.find((a) => !a.startsWith("--"));
const targets = explicit ? [explicit] : findTargets();

if (targets.length === 0) {
  console.error("✗ 未找到 YonWork/YonClaw 安装目标（openclaw/skills/iuap-apcom-myapproval 或旧目录 approve-inbox/iuap-apcom-approveinbox）。");
  console.error("  可显式指定：node deploy.mjs <目标目录>");
  process.exit(1);
}

// 排除 data/ 与 node_modules
const filter = (src) => !src.includes(`${"/"}data${"/"}`) && !src.endsWith("/data") && !src.includes("node_modules");

function copySkillFile(src, destFile, destSkillDir) {
  const skillName = basename(destSkillDir);
  const content = readFileSync(src, "utf-8").replace(/^name:\s*.+$/m, `name: ${skillName}`);
  writeFileSync(destFile, content, "utf-8");
}

function migrateLegacyDataIfNeeded(destSkillDir) {
  const dataDir = join(destSkillDir, "data");
  if (existsSync(dataDir)) return;
  const skillsDir = dirname(destSkillDir);
  for (const legacyName of LEGACY_TARGET_SKILL_DIR_NAMES) {
    const legacyDataDir = join(skillsDir, legacyName, "data");
    if (!existsSync(legacyDataDir)) continue;
    cpSync(legacyDataDir, dataDir, { recursive: true, force: false });
    console.log(`   ✓ data/（从旧目录 ${legacyName} 迁移）`);
    return;
  }
}

for (const dest of targets) {
  console.log(`→ 目标: ${dest}`);
  if (!dryRun) {
    mkdirSync(dest, { recursive: true });
    migrateLegacyDataIfNeeded(dest);
  }
  for (const item of SYNC_ITEMS) {
    const s = join(SRC, item);
    if (!existsSync(s)) continue;
    const d = join(dest, item);
    if (dryRun) {
      console.log(`   [dry-run] ${item}`);
      continue;
    }
    if (item === "SKILL.md") copySkillFile(s, d, dest);
    else cpSync(s, d, { recursive: true, force: true, filter });
    console.log(`   ✓ ${item}`);
  }
  console.log(`   （已保留目标 data/）`);
}

if (!dryRun) {
  console.log("\n部署完成。index.html 刷新即生效；normalize/server 改动需重启运行时的 server 进程。");
}
