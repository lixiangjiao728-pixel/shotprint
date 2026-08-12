import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allowExtensionOrigin, classifyUrl, makeSession, navigationReachedTarget, sameVideoPage, sanitizeComments, shouldReusePage, tokenMatches } from "../worker/browser-act-companion/security.mjs";
import { isCommentEndpoint, observedRequestIds, parseCapturedResponse } from "../worker/browser-act-companion/network-evidence.mjs";

test("companion accepts only extension origins and three HTTPS platform allowlists", () => {
  assert.equal(allowExtensionOrigin("https://shotprint.example"), false);
  assert.equal(allowExtensionOrigin("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), true);
  assert.equal(classifyUrl("http://www.bilibili.com/video/BV1"), null);
  assert.equal(classifyUrl("https://evil.example/?next=https://www.douyin.com/video/1"), null);
  assert.equal(classifyUrl("https://www.bilibili.com/video/BV1")?.platform, "bilibili");
  assert.equal(classifyUrl("https://www.douyin.com/video/1")?.platform, "douyin");
  assert.equal(classifyUrl("https://www.xiaohongshu.com/explore/1")?.platform, "xiaohongshu");
});

test("companion pairing tokens are digest-checked and expire", () => {
  const session = makeSession();
  assert.equal(tokenMatches(session, session.raw), true);
  assert.equal(tokenMatches(session, `${session.raw}x`), false);
  session.expiresAt = Date.now() - 1;
  assert.equal(tokenMatches(session, session.raw), false);
});

test("continuation keeps the same video tab across platform redirect shapes", () => {
  assert.equal(sameVideoPage("xiaohongshu", "https://www.xiaohongshu.com/explore/6a672872000000001c00d1b2", "https://www.xiaohongshu.com/discovery/item/6a672872000000001c00d1b2?x=1"), true);
  assert.equal(sameVideoPage("douyin", "https://www.douyin.com/video/7650427585301630208", "https://www.iesdouyin.com/share/video/7650427585301630208"), true);
  assert.equal(sameVideoPage("douyin", "https://www.douyin.com/video/1", "https://www.douyin.com/video/2"), false);
  const short = "https://v.douyin.com/short-code/";
  const resolved = "https://www.douyin.com/video/7650427585301630208";
  const resolvedKey = "7650427585301630208";
  assert.equal(shouldReusePage("douyin", short, resolved, short, resolvedKey), true);
  assert.equal(shouldReusePage("douyin", short, "https://www.douyin.com/video/222", short, resolvedKey), false);
  assert.equal(navigationReachedTarget("douyin", "https://www.douyin.com/video/2", "https://www.douyin.com/video/1", "https://www.douyin.com/video/1"), false);
  assert.equal(navigationReachedTarget("douyin", short, "https://www.douyin.com/", resolved), true);
  assert.equal(navigationReachedTarget("douyin", short, "https://www.douyin.com/video/111", "https://www.douyin.com/"), false);
  assert.equal(navigationReachedTarget("douyin", short, "https://www.douyin.com/video/111", "https://www.douyin.com/user/example"), false);
  assert.equal(navigationReachedTarget("douyin", short, resolved, "https://www.douyin.com/video/222", short, resolvedKey), false);
});

test("companion sanitization never returns identity, auth, avatar, or raw ids", () => {
  const result = sanitizeComments([{ text: "回复 @真实姓名： 观点内容", likes: 3, userId: "uid-1", avatar: "https://avatar", cookie: "SESSDATA=secret", authorization: "Bearer secret", replyTo: "真实姓名" }], 100);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "观点内容");
  assert.equal(result[0].replyTo, "匿名回复");
  const serialized = JSON.stringify(result);
  for (const forbidden of ["真实姓名", "uid-1", "avatar", "SESSDATA", "Bearer"]) assert.equal(serialized.includes(forbidden), false);
});

test("companion exposes fixed endpoints and never accepts shell or arbitrary commands", async () => {
  const server = await readFile(new URL("../worker/browser-act-companion/server.mjs", import.meta.url), "utf8");
  for (const endpoint of ["/v1/health", "/v1/pair", "/v1/comments", "/v1/playback/prepare", "/v1/cancel"]) assert.match(server, new RegExp(endpoint.replaceAll("/", "\\/")));
  assert.match(server, /shell: false/);
  assert.match(server, /running\.set\(requestId, child\)/);
  assert.match(server, /cancelled\.add\(requestId\)/);
  assert.match(server, /child\.kill\(\)/);
  assert.match(server, /code: "REQUEST_CANCELLED"/);
  assert.doesNotMatch(server, /body\?\.(?:command|script|path|address)/);
  assert.doesNotMatch(server, /cookies (?:get|export|import)|solve-captcha|stealth-extract|--dynamic-proxy|--static-proxy/);
});

test("forged skills use bounded page loading and never replay signed requests", async () => {
  const names = ["bilibili", "douyin", "xiaohongshu"];
  for (const name of names) {
    const script = await readFile(new URL(`../worker/browser-act-skills/${name}-video-comments/scripts/emit_js.py`, import.meta.url), "utf8");
    assert.match(script, /rounds?<15|i<15/);
    assert.doesNotMatch(script, /solve-captcha|stealth|proxy|document\.cookie|localStorage|Authorization/);
    if (name !== "bilibili") assert.doesNotMatch(script, /fetch\(|credentials:'include'|performance\.getEntriesByType/);
  }
});

test("captured network receipts accept only verified 200 GET comment endpoints", () => {
  const payload = { requests: [
    { request_id: "dy-1", method: "GET", status: 200, url: "https://www-hj.douyin.com/aweme/v1/web/comment/list/?cursor=0" },
    { request_id: "preflight", method: "OPTIONS", status: 200, url: "https://www-hj.douyin.com/aweme/v1/web/comment/list/?cursor=0" },
    { request_id: "wrong", method: "GET", status: 200, url: "https://evil.example/aweme/v1/web/comment/list/" },
  ] };
  assert.equal(isCommentEndpoint("douyin", payload.requests[0].url), true);
  assert.deepEqual(observedRequestIds("douyin", payload), ["dy-1"]);
  assert.equal(isCommentEndpoint("xiaohongshu", "https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?cursor=x"), true);
  assert.equal(isCommentEndpoint("xiaohongshu", "http://edith.xiaohongshu.com/api/sns/web/v2/comment/page"), false);
});

test("captured Douyin and Xiaohongshu responses map only anonymous evidence fields", () => {
  const douyin = parseCapturedResponse("douyin", {
    method: "GET",
    status: 200,
    url: "https://www-hj.douyin.com/aweme/v1/web/comment/list/?cursor=0",
    response_body: JSON.stringify({ cursor: 5, has_more: 1, comments: [{ text: "观点甲", digg_count: 9, create_time: 1_786_000_000, reply_id: "0", user: { nickname: "真实姓名", uid: "uid-1", avatar_thumb: { url_list: ["avatar"] } } }] }),
  });
  const xhs = parseCapturedResponse("xiaohongshu", {
    method: "GET",
    status: 200,
    url: "https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?cursor=x",
    response_body: JSON.stringify({ data: { cursor: "next", has_more: true, comments: [{ content: "观点乙", like_count: 3, create_time: 1_786_000_000, user_info: { nickname: "真实姓名", user_id: "uid-2", image: "avatar" }, sub_comments: [{ content: "回复内容", like_count: 1 }] }] } }),
  });
  assert.ok(douyin);
  assert.ok(xhs);
  assert.deepEqual(Object.keys(douyin.comments[0]).sort(), ["likes", "replyTo", "text", "timeLabel"].sort());
  assert.equal(douyin.cursor, "5");
  assert.equal(xhs.comments.length, 2);
  assert.equal(xhs.comments[1].replyTo, true);
  const serialized = JSON.stringify([douyin, xhs]);
  for (const forbidden of ["真实姓名", "uid-1", "uid-2", "avatar", "user_info"]) assert.equal(serialized.includes(forbidden), false);
  assert.equal(parseCapturedResponse("douyin", { method: "POST", status: 200, url: "https://www-hj.douyin.com/aweme/v1/web/comment/list/", response_body: "{\"comments\":[{\"text\":\"不应接受\"}]}" }), null);
  const bilibili = parseCapturedResponse("bilibili", { method: "GET", status: 200, url: "https://api.bilibili.com/x/v2/reply/wbi/main", response_body: JSON.stringify({ data: { cursor: { next: 42, is_end: false }, replies: [] } }) });
  assert.equal(bilibili?.cursor, "42");
});
