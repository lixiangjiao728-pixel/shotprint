---
name: douyin-video-comments
description: Safely extract anonymized comments and prepare playback from a Douyin video page through BrowserAct, with network-first and DOM fallback behavior.
---

# Douyin video comments

Run only in the approved local Chrome login state. Stop on captcha, 403, 429, or login wall. Do not switch sorting, reverse signatures, export headers, solve captcha, use proxies, or download media.

The emitter triggers the page's own lazy loading through at most 15 bounded route-container scrolls and extracts a DOM fallback. The companion separately reads only already-captured 200 responses from `/aweme/v1/web/comment/list/`, maps safe fields in memory, and merges them with the DOM result. Never replay request URLs or expose their signed query parameters. Live verification on 2026-08-08 reached 119 rendered items and 120 unique comment texts across 13 page-generated GET responses, with monotonic cursors and zero overlap between the first two pages.

Use `scripts/emit_js.py comments 100|200` or `scripts/emit_js.py playback 1`, piping stdout to BrowserAct `eval --stdin`.
