---
name: bilibili-video-comments
description: Extract up to 100/200 anonymized comments and prepare playback from a Bilibili video page already opened in BrowserAct.
---

# Bilibili video comments

Use only on a user-selected public Bilibili video in an authenticated local Chrome session. Stop on captcha, 403, 429, or login wall. Never use cookies commands, proxies, stealth, captcha solving, media URLs, or request-header export.

## Workflow

1. Open the video in the approved local `chrome-direct` BrowserAct browser.
2. Run `scripts/emit_js.py comments 100` and pipe its stdout to `browser-act --session <owned-session> eval --stdin`.
3. The emitted JavaScript scrolls the existing comment component with bounded UI actions, reuses only comment URLs already signed and requested by the page, and returns sanitized fields. It does not calculate WBI signatures.
4. For continuation, rerun with target `200` in the same live page/session.
5. If network responses change, the script performs one DOM/Shadow DOM fallback. Do not retry network after captcha/403/429.
6. For playback calibration, use `scripts/emit_js.py playback 1`; it returns page metadata and seeks the existing player to zero without exposing media URLs.

Verified 2026-08-06 on BV11mFLziEyP: first response 21 items, later response 20 items, overlap 2; distinct pagination offsets were produced by the page UI.
