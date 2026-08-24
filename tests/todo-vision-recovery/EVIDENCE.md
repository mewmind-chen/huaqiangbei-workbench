# Workbench Todo Vision Recovery evidence

Date: 2026-08-25 (Asia/Shanghai)

## Current provider audit

The process environment did not contain the Vision keys. The existing local Runtime credential store contained configured values for DeepSeek, OpenRouter, and the describe-image provider. Only boolean presence is recorded in `results.json`; no secret values are stored here.

The direct capability probe used the existing `DEEPSEEK_API_KEY` credential with the project fixture `quote-tps54560.png`. `deepseek-v4-flash-vision-exp` returned HTTP 200 in about 1.4 seconds with the expected JSON text response. The request used an OpenAI-compatible image block (`data:image/png;base64,...`). A second existing describe-image/GLM path also returned HTTP 200, but DeepSeek was selected because it is the previously verified project Vision path and is directly callable from Workbench with the existing credential. No router or fallback was added.

## Final call chain

`Screenshot -> blobToJpegBase64 -> Workbench server recognizeChatShot -> callTodoVision (DeepSeek) -> TODO_VISION_PROMPT -> extractTodoItems -> RecognizeDraft[] -> per-row Human Review -> Confirm -> Todo Store`

The DeepSeek provider is only responsible for image plus prompt to model response. Todo type validation, field normalization, multi-item handling, preview, editing, and saving remain in Workbench. Platform was not modified and no new API contract was added.

The current production path is the existing Cloudflare Tunnel entry for `hq.newmindchen.com`, routed to the Workbench preview on loopback port `8091`; the Radar process and its `radar.newmindchen.com` route remain untouched. The runtime key is read from the existing local Platform/Runtime credential store and is not committed.

## Fixture results

The five parser fixtures in `tests/todo-vision-recovery.test.mjs` pass. CASE1 preserves `TPS54560DDAR` exactly and leaves absent amount/date as `null`; CASE2 is `发货`; CASE3 is `发票`; CASE4 remains two independent drafts; CASE5 does not invent a customer, amount, or date.

## UI results

Clipboard paste was exercised against `https://hq.newmindchen.com/` with the real image fixture. DeepSeek returned one draft, the UI showed `识别结果（逐条确认）` and `尚未保存 1 条`, and no Todo Store row existed until `确认保存` was clicked. The draft preserved `TPS54560DDAR`; after confirmation, the Todo Store showed the saved row and `已保存 1 条待办`.

Production upload was exercised through the in-app browser file chooser with the same fixture and returned one pending draft with exact `TPS54560DDAR`; confirmation saved it. The external Chrome extension file chooser separately returned `Not allowed` because file URL access is disabled; enable Chrome extension Details → **Allow access to file URLs** to repeat that browser-specific path. This is an environment permission issue, not an application error.

## Verification

- `npm test`: pass (160 script tests + 44 TypeScript/test suites)
- `npm run typecheck`: pass
- `npm run build`: pass
- Production homepage is HTTP 200 after deployment. Live clipboard and upload both reached DeepSeek Vision, produced `RecognizeDraft[]`, kept the draft pending until human confirmation, and saved only after `确认保存`. The production model is `deepseek-v4-flash-vision-exp`; no XAI credential, URL, model, retry, or fallback is in the Todo Recognition chain.
- A stale/corrupt local PGLite directory was preserved at `.data/pglite-corrupt-20260825`; the live preview uses a fresh `.data/pglite-live` directory so the runtime remains healthy. No Radar files or processes were changed.
