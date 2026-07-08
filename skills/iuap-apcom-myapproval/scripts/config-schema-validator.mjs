#!/usr/bin/env node
// 零依赖 JSON Schema 校验器（draft-07 子集）。见 initiative 2026-06-25-ui-config-json-schema。
//
// 仅支持本项目 schema 用到的 draft-07 关键字：
//   type | const | enum | properties | required | additionalProperties(false)
//   items | anyOf | oneOf | allOf | $ref(仅同文件 $defs) | description(用于错误信息)
// 不支持: $ref 跨文件、pattern/format/formatMinimum、if/then/else、dependencies、minLength 等。
// 保持标准 draft-07 写法：将来可换 Ajv 校验同一批 schema，无需重写。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMAS_DIR = join(__dirname, "..", "references", "schemas");

function isMainModule(metaUrl) {
  return process.argv[1] && fileURLToPath(metaUrl) === process.argv[1];
}

function typeMatches(value, type) {
  if (Array.isArray(type)) return type.some((t) => typeMatches(value, t));
  switch (type) {
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}

function isValid(value, schema, root) {
  return validateAgainstSchema(value, schema, root).errors.length === 0;
}

// 深度优先收集所有错误。path 为 JSON-pointer 风格字符串（根为 "/"）。
function collectErrors(value, schema, root, path, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (resolved) collectErrors(value, resolved, root, path, errors);
    return;
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path, message: `值 ${JSON.stringify(value)} 不在允许的枚举内: [${schema.enum.join(", ")}]` });
  }

  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    const expected = Array.isArray(schema.type) ? schema.type.join("|") : schema.type;
    errors.push({ path, message: `类型应为 ${expected}，实际为 ${actualTypeName(value)}` });
    return; // 类型不符，后续 properties/items 无意义
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
        errors.push({ path: `${path === "/" ? "" : path}/${key}`, message: `缺少必填属性 "${key}"` });
      }
    }
    const allowed = new Set(Object.keys(properties));
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path === "/" ? "" : path}/${key}`;
      if (allowed.has(key)) {
        collectErrors(child, properties[key], root, childPath, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({
          path: childPath,
          message: `未声明的属性 "${key}"；允许的属性: [${[...allowed].join(", ")}]`,
        });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        // map 结构：动态 key 的值统一按此 schema 校验（draft-07 additionalProperties 作为 schema）。
        collectErrors(child, schema.additionalProperties, root, childPath, errors);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      collectErrors(item, schema.items, root, `${path === "/" ? "" : path}/${index}`, errors);
    });
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) collectErrors(value, sub, root, path, errors);
  }

  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((sub) => isValid(value, sub, root))) {
      errors.push({ path, message: schema.description || "值不满足 anyOf 任一分支" });
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((sub) => isValid(value, sub, root)).length;
    if (matches !== 1) {
      const reason = matches === 0 ? "不满足 oneOf 任一分支" : `同时满足 oneOf 多个分支（${matches} 个）`;
      errors.push({ path, message: schema.description ? `${schema.description}（${reason}）` : reason });
    }
  }
}

function actualTypeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) return null;
  return ref
    .slice(2)
    .split("/")
    .reduce((node, segment) => (node == null ? node : node[segment.replace(/~1/g, "/").replace(/~0/g, "~")]), root);
}

export function validateAgainstSchema(value, schema, rootSchema) {
  const errors = [];
  collectErrors(value, schema, rootSchema || schema, "/", errors);
  return { ok: errors.length === 0, errors };
}

export function loadSchema(name, schemasDir = DEFAULT_SCHEMAS_DIR) {
  const file = join(schemasDir, `${name}.schema.json`);
  if (!existsSync(file)) throw new Error(`Schema not found: ${file}`);
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function validateConfig(name, value, { schemasDir = DEFAULT_SCHEMAS_DIR } = {}) {
  const schema = loadSchema(name, schemasDir);
  return validateAgainstSchema(value, schema);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--name" || arg === "--config") options.name = argv[++index];
    else if (arg === "--file") options.file = argv[++index];
    else if (arg === "--schemas-dir") options.schemasDir = argv[++index];
    else if (arg === "--format") options.format = argv[++index];
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.name || !options.file) {
    process.stderr.write("用法: config-schema-validator.mjs --name <schema-name> --file <config.json> [--schemas-dir <dir>]\n");
    process.exitCode = 2;
    return;
  }
  let value;
  try {
    value = JSON.parse(readFileSync(options.file, "utf-8"));
  } catch (error) {
    process.stderr.write(`读取/解析配置失败: ${error?.message || error}\n`);
    process.exitCode = 2;
    return;
  }
  const report = validateConfig(options.name, value, { schemasDir: options.schemasDir });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
