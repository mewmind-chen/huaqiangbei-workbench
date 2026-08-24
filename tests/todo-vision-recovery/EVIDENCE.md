# Workbench Todo Vision Recovery evidence

Date: 2026-08-25 (Asia/Shanghai)

## Current provider audit

The process environment did not contain the Vision keys. The existing local Runtime credential store contained configured values for DeepSeek, OpenRouter, and the describe-image provider. Only boolean presence is recorded in `results.json`; no secret values are stored here.

The direct capability probe used the existing `DEEPSEEK_API_KEY` credential with the project fixture `quote-tps54560.png`. `deepseek-v4-flash-vision-exp` returned HTTP 200 in about 1.4 seconds with the expected JSON text response. The request used an OpenAI-compatible image block (`data:image/png;base64,...`). A second existing describe-image/GLM path also returned HTTP 200, but DeepSeek was selected because it is the previously verified project Vision path and is directly callable from Workbench with the existing credential. No router or fallback was added.

## Final call chain

`Screenshot -> blobToJpegBase64 -> Workbench server recognizeChatShot -> callTodoVision (DeepSeek) -> TODO_VISION_PROMPT -> extractTodoItems -> RecognizeDraft[] -> per-row Human Review -> Confirm -> Todo Store`

The DeepSeek provider is only responsible for image plus prompt to model response. Todo type validation, field normalization, multi-item handling, preview, editing, and saving remain in Workbench. Platform was not modified and no new API contract was added.

## Fixture results

The five parser fixtures in `tests/todo-vision-recovery.test.mjs` pass. CASE1 preserves `TPS54560DDAR` exactly and leaves absent amount/date as `null`; CASE2 is `发货`; CASE3 is `发票`; CASE4 remains two independent drafts; CASE5 does not invent a customer, amount, or date.

## UI results

Clipboard paste was exercised against the local server with the real image fixture. DeepSeek returned one draft, the UI showed `识别结果（逐条确认）` and `尚未保存 1 条`, and no Todo Store row existed until `确认保存` was clicked. After confirmation, one pending Todo row appeared with the original `TPS54560DDAR` text.

Chrome file upload was attempted through the browser file chooser and was rejected by the extension with `Not allowed`. Enable Chrome extension Details → **Allow access to file URLs** to repeat the upload path. This is an environment/browser permission blocker, not an application error.

## Verification

- `npm test`: pass (160 script tests + 44 TypeScript/test suites)
- `npm run typecheck`: pass
- `npm run build`: pass
- Production homepage was HTTP 200 before this branch was deployed. A production clipboard attempt on the current live build showed `识别服务暂不可用`, confirming that hq.newmindchen.com is still running the pre-PR xAI Todo build. Post-deployment Todo recognition remains unverified because this workspace has no Vercel CLI/project deployment credentials; the branch is ready for PR/preview deployment.
