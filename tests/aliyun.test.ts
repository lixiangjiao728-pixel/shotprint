import assert from "node:assert/strict";
import test from "node:test";
import { createObjectKey, createUploadToken, inspectOssObject, normalizeBailianBaseUrl, presignOssUrl, verifyUploadToken } from "../lib/aliyun.ts";
import type { ShotprintEnv } from "../lib/server.ts";

const runtime: ShotprintEnv = {
  OSS_ACCESS_KEY_ID: "test-access-id",
  OSS_ACCESS_KEY_SECRET: "test-secret-never-ship",
  OSS_BUCKET: "shotprint-private",
  OSS_ENDPOINT: "oss-cn-beijing.aliyuncs.com",
  RATE_LIMIT_SALT: "test-upload-token-secret",
};

test("OSS PUT and GET signatures are scoped without exposing the secret", async () => {
  const objectKey = "shotprint-temp/2026-07-30/fixture.mp4";
  const put = await presignOssUrl(runtime, "PUT", objectKey, { contentType: "video/mp4", ttlSeconds: 900, nowSeconds: 1_000 });
  const get = await presignOssUrl(runtime, "GET", objectKey, { ttlSeconds: 900, nowSeconds: 1_000 });
  assert.match(put, /^https:\/\/shotprint-private\.oss-cn-beijing\.aliyuncs\.com\//);
  assert.match(put, /OSSAccessKeyId=test-access-id/);
  assert.doesNotMatch(put, /test-secret-never-ship/);
  assert.notEqual(new URL(put).searchParams.get("Signature"), new URL(get).searchParams.get("Signature"));
});

test("upload token accepts intact claims and rejects tampering", async () => {
  const claims = { objectKey: "shotprint-temp/fixture.mp4", mimeType: "video/mp4", size: 1024, durationMs: 5000, expires: Date.now() + 60_000 };
  const token = await createUploadToken(runtime, claims);
  assert.deepEqual(await verifyUploadToken(runtime, token), claims);
  const tampered = `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`;
  assert.equal(await verifyUploadToken(runtime, tampered), null);
});

test("generated object keys are isolated and MIME-scoped", () => {
  assert.match(createObjectKey("video/webm"), /^shotprint-temp\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.webm$/);
  assert.match(createObjectKey("video/quicktime", "../unsafe"), /^unsafe\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.mov$/);
});

test("OSS object inspection returns only verified upload metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "HEAD");
    return new Response(null, { status: 200, headers: { "content-length": "1024", "content-type": "video/mp4" } });
  };
  try {
    assert.deepEqual(await inspectOssObject(runtime, "shotprint-temp/fixture.mp4"), { size: 1024, mimeType: "video/mp4" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bailian API host accepts console domains and full compatible base URLs", () => {
  assert.equal(
    normalizeBailianBaseUrl("ws-example.cn-beijing.maas.aliyuncs.com"),
    "https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    normalizeBailianBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1/"),
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
  assert.throws(() => normalizeBailianBaseUrl("http://example.com"), /HTTPS|invalid/);
});
