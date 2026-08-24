# Intelligence presentation boundary — test evidence

Source: `tests/intelligence-presentation-boundary/presentation.test.mjs`

| Case | Setup | Must not | Must |
|---|---|---|---|
| 1 | Platform claim「立创有现货」+ 本地高库存/多挂货 | `buildMarketCards` 改成「挂货商家多」 | 只展示 Platform claim / cards |
| 2 | `verdict.state = 未知` | 把 unknown 改成热门 | 三张卡片均为 unknown |
| 3 | 库存很高、询价很多，公开 evidence 不足 | 热门 / 缺货 / 涨价 | 内部 advice 可单独存在 |
| 4 | Platform unavailable | 降级结果看起来像 evidence-backed | `origin=fallback`，文案含「降级」 |
| 5 | Company evidence 空 + 强 snippet | 联系人 / 注册资本 / 主营品牌 / 热卖型号 | 全部为空 |
| 6 | Company 有 evidence | 只给最终自然语言 | 展示 claim + source + url + confidence |
| 7 | snippet 含 authorized distributor / TI ADI ST | 从 snippet 增加 claim | `claimsFromSnippets` 返回 []；`identityPatchFromIntel` 不抽应用 |
| 8 | 人工 corrected | research save 覆盖 corrected_json 或回传 Platform | upsert 不写 review 列；review 不调 `/v1/` |
| extra | claim 无对应 evidence | 把「平稳」当公开结论 | `publicState=未知`，卡片 unknown |

UI 源码约束：`lookup-report.tsx` 使用 `presentPartIntelligence` / `presentCompanyIntelligence`，不再 `buildMarketCards({ analysis, identity, inquirers })`。
