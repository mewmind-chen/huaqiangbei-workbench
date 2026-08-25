# Workbench Todo Vision Baseline

Status: **YES**  
Baseline: `main` after PR #1  
Merge commit: `e40b24fbeb66a53ed74646393e3a8c31eac3deea`  
Recorded: 2026-08-25 (Asia/Shanghai)

## Runtime

- Vision provider: DeepSeek server-side chat completions.
- Model: `deepseek-v4-flash-vision-exp`.
- `DEEPSEEK_API_KEY` is injected only into the server runtime. It is not committed, bundled, or logged.
- No Platform change, no new API contract, no new provider, and no new Vision gateway.
- The non-Todo xAI integration in `src/lib/part-lookup.ts` remains unchanged.

## Ownership boundary

`Screenshot -> DeepSeek Vision -> RecognizeDraft[] -> Pending Preview -> Human Confirm -> Todo DB`

Vision extracts semantics. Workbench validates and presents drafts. `addItem/upsertItem` runs only after an explicit per-row confirmation. MPN text is retained as returned; the prompt forbids completion, correction, or suffix guessing. Uncertain customer, amount, and date values remain conservative (`客户` / `null`).

## Post-merge regression

- `npm test`: PASS — 160 script tests + 45 Workbench/type suites.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- PGLite assets are present and non-empty: `pglite.data`, `pglite.wasm`, `initdb.wasm`.

## Production smoke

Target: `https://hq.newmindchen.com/` through the existing Workbench runtime.

| Case | Result |
|---|---|
| Single quote screenshot | PASS — one pending draft, exact `TPS54560DDAR`, type `报价` |
| Multiple-item screenshot | PASS — two independent pending drafts; edit and per-row discard verified |
| Fuzzy screenshot | PASS — no invented customer, amount, or date; no Todo draft created |
| No-business image | PASS — `未识别出待办事项`; no draft created |
| Confirm Save | PASS — one synthetic acceptance item was pending before confirmation, saved after explicit confirmation, appeared in the Todo list, and remained after page refresh |

### Confirm Save acceptance record

- Test data: synthetic quote fixture, MPN `TPS54560DDAR`, type `报价`.
- Before confirm: no matching Todo was visible; pending state contained one draft and no database row was shown.
- After confirm: UI reported `已保存 1 条待办`, pending preview cleared, and the Todo list showed exactly one matching quote item.
- After refresh: the same item persisted with the original MPN and type.
- No additional Todo was created and no field was auto-completed.
- The UI does not expose the generated UUID; the save/persistence result is recorded by the visible Todo row and refresh check.
- This row is explicitly marked here as a **production acceptance test** using synthetic data, not a customer record.

## Known limitations

1. Production recognition requires a valid server-side `DEEPSEEK_API_KEY`; if absent, the UI reports `vision_not_configured`.
2. The generated Todo UUID is internal and is not currently shown in the UI.
3. There is intentionally no silent AI fallback or automatic database write.
