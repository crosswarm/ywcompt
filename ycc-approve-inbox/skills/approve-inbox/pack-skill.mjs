#!/usr/bin/env node
/**
 * pack-skill.mjs — 产出「纯净可分发」的 approve-inbox skill（供所有用户安装到 YonClaw）。
 *
 * 只保留运行时必需文件，剔除开发/评测/调试/本机产物：
 *   - 所有 *.test.mjs 单测
 *   - eval/（评测框架 + 场景 + 录制）
 *   - deploy.mjs / pack-skill.mjs（开发脚本）
 *   - web/.omc/（OMC 调试状态）、data/（用户运行时数据）
 *   - .DS_Store / .gitignore（杂项）
 *
 * 保留：SKILL.md、web/(server/index/normalize/sample-data)、widget/、scripts/(运行时文件)、
 *      analysis/(dimensions/field-dict/fetch-profiles/profile-loader + profiles/*)。
 *
 * 用法：
 *   node skills/approve-inbox/pack-skill.mjs            # 产出到 <repo>/dist/approve-inbox + .tgz
 *   node skills/approve-inbox/pack-skill.mjs <输出目录>  # 指定输出根目录
 */

import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const SRC = dirname(fileURLToPath(import.meta.url)); // skills/approve-inbox
const REPO = join(SRC, "..", "..");
const OUT_ROOT = process.argv[2] || join(REPO, "dist");
const DEST = join(OUT_ROOT, "approve-inbox");
const TARBALL = join(OUT_ROOT, "approve-inbox-skill.tgz");

// 黑名单：剔除开发/评测/调试/产物（对新增运行时文件鲁棒——默认全留，只排除这些）
function keep(srcPath) {
  const rel = srcPath.slice(SRC.length + 1);
  if (!rel) return true; // 根目录
  const parts = rel.split("/");
  const base = parts[parts.length - 1];
  if (base === ".DS_Store" || base === ".gitignore") return false;
  if (base === "deploy.mjs" || base === "pack-skill.mjs") return false;
  if (base.endsWith(".test.mjs")) return false;
  if (parts.includes("eval") || parts.includes("data") || parts.includes(".omc") || parts.includes("node_modules")) return false;
  return true;
}

function listFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

// 清理旧产物
if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

cpSync(SRC, DEST, { recursive: true, filter: keep });

// 统计
const files = listFiles(DEST).map((f) => f.slice(DEST.length + 1)).sort();
const totalKB = (files.reduce((s, f) => s + statSync(join(DEST, f)).size, 0) / 1024).toFixed(1);

// 打 tarball（解压即得 approve-inbox/，可直接放进 openclaw/skills/）
execSync(`tar -czf ${JSON.stringify(TARBALL)} -C ${JSON.stringify(OUT_ROOT)} approve-inbox`, { stdio: "ignore" });

console.log(`✅ 纯净 skill 已产出：`);
console.log(`   目录：${DEST}`);
console.log(`   压缩包：${TARBALL}`);
console.log(`   文件数：${files.length}（${totalKB} KB）`);
console.log(`\n包含文件：`);
for (const f of files) console.log(`   ${f}`);
console.log(`\n安装：解压 tgz 得 approve-inbox/，放入 YonClaw 的 <profile>/userData/runtime/openclaw/skills/ 即可。`);
