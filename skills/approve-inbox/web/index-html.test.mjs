import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

test("原始单据链接显式新窗口打开，不占用驾驶舱窗口", () => {
  assert.match(html, /data-original-detail-url="1"/);
  assert.match(
    html,
    /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*window\.open\(originalLink\.href,\s*'_blank',\s*'noopener,noreferrer'\);/s
  );
});
