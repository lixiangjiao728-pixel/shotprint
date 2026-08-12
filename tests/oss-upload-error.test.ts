import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser OSS transport failures explain the CORS boundary instead of leaking Failed to fetch", async () => {
  const source = await readFile(new URL("../app/ShotprintStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /浏览器无法连接 OSS 上传视频/);
  assert.match(source, /允许 shotprint\.xyz 跨域 PUT/);
});
