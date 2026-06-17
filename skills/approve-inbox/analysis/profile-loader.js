/**
 * profile-loader.js — 分析 profile 选择 + 字段中文化（纯函数 + 文件加载）
 *
 * - selectProfile(item)：按 docType/billnum/标题 匹配 profile（profiles/*.json），无命中→generic。
 * - localizeFields(fields, dict?)：把 report/detail 抓到的英文字段 [{key,value}] 转
 *   [{name(中文), value, dim}]，便于 prompt 与展示；未知 key 保留原 key。
 *
 * 零依赖，纯 Node。profiles 与 field-dict 在模块加载时一次性读入并缓存。
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandDimensions } from './dimensions.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(HERE, 'profiles');
const FIELD_DICT_PATH = join(HERE, 'field-dict.json');

// ── 加载 profiles ────────────────────────────────────────
let _profilesCache;
/** 读取全部 profiles/*.json（含 generic），返回数组；缓存 */
export function loadProfiles() {
  if (_profilesCache) return _profilesCache;
  const list = [];
  try {
    for (const f of readdirSync(PROFILES_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = JSON.parse(readFileSync(join(PROFILES_DIR, f), 'utf-8'));
        p._file = f;
        list.push(p);
      } catch {
        /* 跳过坏文件 */
      }
    }
  } catch {
    /* 目录缺失 */
  }
  _profilesCache = list;
  return list;
}

/** 取 generic 兜底 profile（无则返回最小占位） */
function genericProfile(profiles) {
  return (
    profiles.find((p) => p._file === 'generic.json') || {
      docType: '通用兜底',
      match: [],
      commonDimensions: ['amount-compliance', 'info-consistency', 'approval-authority'],
      businessRules: [],
      keyFields: [],
      promptHint: ''
    }
  );
}

/**
 * 选择 profile（纯匹配，可注入 profiles 测试）。
 * 匹配优先级：match 关键词命中 billnum/docType/title（命中最多者胜）→ generic。
 * @param {{docType?:string, billnum?:string, title?:string, webUrl?:string}} item
 * @param {Array} [profiles]
 * @returns {object} profile（必返回，至少 generic）
 */
export function selectProfile(item, profiles) {
  const list = profiles || loadProfiles();
  if (!item) return genericProfile(list);

  // 从 webUrl 提取 billnum 兜底
  let billnum = item.billnum || '';
  if (!billnum && item.webUrl) {
    const m = String(item.webUrl).match(/\/voucher\/([^/?]+)/i);
    if (m) billnum = m[1];
  }
  const haystack = `${billnum} ${item.docType || ''} ${item.title || ''}`.toLowerCase();

  let best = null;
  let bestScore = 0;
  for (const p of list) {
    if (p._file === 'generic.json') continue;
    const matches = Array.isArray(p.match) ? p.match : [];
    let score = 0;
    for (const kw of matches) {
      // 按关键词长度加权：更精确（更长）的匹配优先，避免宽前缀盖过专属全名
      if (kw && haystack.includes(String(kw).toLowerCase())) score += String(kw).length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best || genericProfile(list);
}

/** 展开 profile 的通用维定义（供 prompt 组装） */
export function profileDimensions(profile) {
  return expandDimensions(profile?.commonDimensions || []);
}

// ── 字段中文化 ────────────────────────────────────────────
let _fieldDictCache;
/** 读取 field-dict.json，扁平化为 {key: {cn, dim}}；缓存 */
export function loadFieldDict() {
  if (_fieldDictCache) return _fieldDictCache;
  const flat = {};
  try {
    if (existsSync(FIELD_DICT_PATH)) {
      const raw = JSON.parse(readFileSync(FIELD_DICT_PATH, 'utf-8'));
      for (const [group, entries] of Object.entries(raw)) {
        if (group.startsWith('_') || typeof entries !== 'object') continue;
        for (const [k, v] of Object.entries(entries)) {
          if (k.startsWith('_') || !v || typeof v !== 'object') continue;
          if (!flat[k]) flat[k] = { cn: v.cn || k, dim: v.dim };
        }
      }
    }
  } catch {
    /* 容错 */
  }
  _fieldDictCache = flat;
  return flat;
}

/** 模糊维度推断：金额类字段归 amount-compliance */
function inferDim(key) {
  const k = key.toLowerCase();
  if (/(money|amount|price|total.*money)/.test(k)) return 'amount-compliance';
  if (/(date|time|期)/.test(k)) return 'timeliness';
  return undefined;
}

/**
 * 把英文字段列表中文化。
 * @param {Array<{key:string, value:string}>} fields
 * @param {object} [dict] 可注入测试
 * @returns {Array<{name:string, value:string, key:string, dim?:string}>}
 */
export function localizeFields(fields, dict) {
  if (!Array.isArray(fields)) return [];
  const d = dict || loadFieldDict();
  return fields.map((f) => {
    const hit = d[f.key];
    return {
      name: hit?.cn || f.key,
      value: f.value,
      key: f.key,
      dim: hit?.dim || inferDim(f.key)
    };
  });
}
