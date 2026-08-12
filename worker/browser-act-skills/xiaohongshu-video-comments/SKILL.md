---
name: xiaohongshu-video-comments
description: Safely extract anonymized comments and prepare playback from a Xiaohongshu note page through BrowserAct, with network-first and DOM fallback behavior.
---

# Xiaohongshu video comments

Run only in the approved local Chrome login state. Stop on captcha, 403, 429, or login wall. Do not switch sorting, reverse signatures, export headers, solve captcha, use proxies, or download media.

The emitter triggers the page's own lazy loading through at most 15 bounded `.note-scroller` scrolls and extracts a DOM fallback. The companion separately reads only already-captured 200 responses from `/api/sns/web/v2/comment/page`, maps safe fields in memory, and merges them with the DOM result. Never replay this signed request: live verification on 2026-08-08 showed an independent same-origin fetch returns 406 while page-triggered responses succeed. The verified sample reached 71 rendered items and five distinct network pages without captcha, 403, or 429; report a partial sample when the target is not reached.

Use `scripts/emit_js.py comments 100|200` or `scripts/emit_js.py playback 1`, piping stdout to BrowserAct `eval --stdin`.
