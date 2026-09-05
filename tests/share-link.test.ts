import assert from "node:assert/strict";
import test from "node:test";
import { platformForUrl, shareLinks } from "../lib/share-link.ts";
import { mp4Tracks } from "../lib/mp4-tracks.ts";

test("share text extracts platform links and preserves access tokens and Bilibili parts", () => {
  for (const [text, url, platform] of [
    ["复制此链接 https://v.douyin.com/abc/ 打开抖音", "https://v.douyin.com/abc/", "douyin"],
    ["分享笔记：https://www.xiaohongshu.com/explore/abc?xsec_token=a%2Bb&xsec_source=pc_share。", "https://www.xiaohongshu.com/explore/abc?xsec_token=a%2Bb&xsec_source=pc_share", "xiaohongshu"],
    ["【视频】 https://www.bilibili.com/video/BV123?p=2）", "https://www.bilibili.com/video/BV123?p=2", "bilibili"],
  ]) {
    assert.deepEqual(shareLinks(text), [url]);
    assert.equal(platformForUrl(url), platform);
  }
  assert.equal(shareLinks("https://b23.tv/abc https://xhslink.com/def").length, 2);
  assert.equal(shareLinks("https://b23.tv/abc https://b23.tv/abc").length, 1);
});

test("platform recognition rejects lookalikes, credentials and non-HTTPS links", () => {
  for (const url of ["https://notdouyin.example/video/123", "https://douyin.com.attacker.test/", "https://user:password@www.douyin.com/video/123", "http://b23.tv/abc", "javascript:alert(1)"]) assert.equal(platformForUrl(url), "unknown");
});

function box(name: string, payload: Buffer) {
  const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(name, 4);
  return Buffer.concat([header, payload]);
}
function track(handler: string) {
  const payload = Buffer.alloc(12); payload.write(handler, 8);
  return box("trak", box("mdia", box("hdlr", payload)));
}
function bytes(value: Buffer): ArrayBuffer { return Uint8Array.from(value).buffer; }
test("automatic video validation requires real audio and video track handlers", () => {
  assert.deepEqual(mp4Tracks(bytes(box("moov", Buffer.concat([track("vide"), track("soun")])))), { video: true, audio: true });
  assert.deepEqual(mp4Tracks(bytes(box("moov", track("vide")))), { video: true, audio: false });
  assert.deepEqual(mp4Tracks(bytes(box("mdat", Buffer.from("hdlr vide soun")))), { video: false, audio: false });
  assert.throws(() => mp4Tracks(bytes(Buffer.from("not an mp4"))), /VIDEO_CONTAINER_INVALID/);
});
