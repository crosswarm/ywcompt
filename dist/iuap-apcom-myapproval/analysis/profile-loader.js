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

function firstText(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

function humanizeKey(key) {
  const s = String(key || '').trim();
  if (!s) return '未命名字段';
  if (/[\u4e00-\u9fa5]/.test(s)) return s;
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedAscii(s) {
  return String(s || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isTechnicalName(name, key) {
  const n = String(name || '').trim();
  if (!n || /[\u4e00-\u9fa5]/.test(n)) return false;
  const k = String(key || '').trim();
  if (k && normalizedAscii(n) === normalizedAscii(k)) return true;
  return /[_A-Z]|Id$|Status$|Budget$|Digit$|^is[A-Z]|^can[A-Z]/.test(n);
}

function displayValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return '';
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        return displayValue(JSON.parse(s));
      } catch {
        return s;
      }
    }
    return s;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(displayValue).filter(Boolean).join('、');
  }
  if (typeof value === 'object') {
    const primary = firstText(
      value.name,
      value.displayName,
      value.label,
      value.title,
      value.text,
      value.value,
      value.code,
      value.id
    );
    if (primary) return primary;
    return Object.entries(value)
      .slice(0, 4)
      .map(([k, v]) => {
        const sv = displayValue(v);
        return sv ? `${humanizeKey(k)}:${sv}` : '';
      })
      .filter(Boolean)
      .join('，');
  }
  return String(value);
}

/**
 * 把英文字段列表中文化。
 * @param {Array<{key?:string, name?:string, label?:string, caption?:string, displayName?:string, value:any}>} fields
 * @param {object} [dict] 可注入测试
 * @returns {Array<{name:string, value:string, key:string, dim?:string}>}
 */
export function localizeFields(fields, dict) {
  if (!Array.isArray(fields)) return [];
  const d = dict || loadFieldDict();
  return fields.map((f) => {
    const key = firstText(f?.key, f?.field, f?.fieldName, f?.code, f?.name, f?.label);
    const hit = d[key];
    const explicitName = firstText(f?.label, f?.caption, f?.displayName, f?.name);
    const name = hit?.cn && isTechnicalName(explicitName, key)
      ? hit.cn
      : firstText(explicitName, hit?.cn, humanizeKey(key));
    return {
      name,
      value: displayValue(f?.value),
      key: key || name,
      dim: hit?.dim || inferDim(key || name)
    };
  }).filter((f) => f.value !== '');
}
