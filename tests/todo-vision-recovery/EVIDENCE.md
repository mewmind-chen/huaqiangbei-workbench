# Workbench Todo Vision Recovery evidence

Date: 2026-08-25 (Asia/Shanghai)

## Current provider audit

The initial 8091 process did not contain the server-side Vision credential and returned the explicit `vision_not_configured` state. The existing DSH credential store contained a configured DeepSeek credential; it was injected into the restarted server process only. No secret value is recorded here or in `results.json`.

The direct capability probe used the existing `DEEPSEEK_API_KEY` credential with the project fixture `quote-tps54560.png`. `deepseek-v4-flash-vision-exp` returned HTTP 200 in about 1.4 seconds with the expected JSON text response. The request used an OpenAI-compatible image block (`data:image/png;base64,...`). A second existing describe-image/GLM path also returned HTTP 200, but DeepSeek was selected because it is the previously verified project Vision path and is directly callable from Workbench with the existing credential. No router or fallback was added.

## Final call chain

`Screenshot -> blobToJpegBase64 -> Workbench server recognizeChatShot -> callTodoVision (DeepSeek) -> TODO_VISION_PROMPT -> extractTodoItems -> RecognizeDraft[] -> per-row Human Review -> Confirm -> Todo Store`

The DeepSeek provider is only responsible for image plus prompt to model response. Todo type validation, field normalization, multi-item handling, preview, editing, and saving remain in Workbench. Platform was not modified and no new API contract was added.

The current production path is the existing Cloudflare Tunnel entry for `hq.newmindchen.com`, routed to the Workbench preview on loopback port `8091`; the Radar process and its `radar.newmindchen.com` route remain untouched. The runtime key is read from the existing DSH credential store into the server process and is not committed, bundled, or logged.

## Fixture results

The five acceptance fixtures plus one invoice regression in `tests/todo-vision-recovery.test.mjs` pass. CASE1 preserves `TPS54560DDAR` exactly; CASE2 returns two independent drafts without merging; CASE3 returns `发货`; CASE4 does not invent customer, amount, or date; CASE5 returns `no_todo_detected`. The invoice regression still preserves `发票` with null amount/date.

## UI results

Clipboard paste was exercised against `https://hq.newmindchen.com/` with the redacted quote fixture. DeepSeek returned one draft, the UI showed `识别结果（逐条确认）` and `尚未保存 1 条`, and no Todo Store row was created during this acceptance run. The draft preserved `TPS54560DDAR`.

Production upload was exercised through the in-app browser file chooser with the same fixture and returned one pending draft with exact `TPS54560DDAR`. A synthetic, non-customer two-item image returned two separate pending rows (`TPS54560DDAR 1000pcs 报价` and `明天安排开发票`); the first opened the edit dialog and the second was discarded independently. No confirm/save action was executed in this run, so no acceptance fixture was persisted.

## Verification

- `npm test`: pass (160 script tests + 45 TypeScript/test suites)
- `npm run typecheck`: pass
- `npm run build`: pass
- Production homepage is HTTP 200. Live clipboard and upload reached DeepSeek Vision, produced `RecognizeDraft[]`, kept drafts pending until human confirmation, and did not auto-save. The production model is `deepseek-v4-flash-vision-exp`; no XAI credential, URL, model, retry, or fallback is in the Todo Recognition chain.
- The built client bundle contains no `DEEPSEEK_API_KEY`, DeepSeek endpoint, or provider credential reference; the server bundle contains the server-only provider call.
- A stale/corrupt local PGLite directory was preserved at `.data/pglite-corrupt-20260825`; the live preview uses a fresh `.data/pglite-live` directory so the runtime remains healthy. No Radar files or processes were changed.
