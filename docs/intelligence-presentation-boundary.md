# Workbench Intelligence Presentation Boundary

本文件记录 Workbench 对 Platform Part / Company Intelligence 的展示边界。不修改 Platform Contract、Plugin、Radar。

## 1. 修改前 Part 链

```
SearchPanel.runLookup
  → researchViaPlatform POST /v1/parts/research
       context: quotation { openCount, recentCount, lastQuotedAt }
  → Platform: identity / offers / evidence / verdict / cards / advice
  → Workbench 只取 identity / offers / advice / recommendation
       （丢掉 verdict / evidence / cards）
  → LookupReport.buildMarketCards(analysis, inquirers, previous)
       if 询价条数 / 挂货家数 → 热门
       if 立创库存 → 缺货或偏松
       if 上次立创价 → 涨跌
  → 「市场观察」卡片
  → 人工 review（accept / reject / corrected）
  → search_reports.payload + corrected_json
```

## 2. 修改前 Company 链

```
SearchPanel.runLookup
  → researchViaPlatform POST /v1/companies/research（无 context）
  → Platform: companies / shopRows / evidence / verdict / profile
  → Workbench 只取 companies / shopRows
       intel 固定 null，evidence / verdict / profile 丢弃
  → LookupReport 展示商铺名片、库存结构
  → 失败时 lookupStep intel → briefFromHits(snippet)
       summary 当「公开介绍」
       identityPatchFromIntel 用关键词抽「应用」
  → 人工 review → save
```

## 3. 双重结论问题

Platform 已经给出 `verdict.state` / `claims[]` / `evidence[]` / `advice`。

Workbench 再用本地 if/else 根据库存和询价生成另一套「热门 / 货 / 价」。  
snippet 里出现 `authorized distributor` 或 `TI, ADI, ST` 时，也容易被当成授权或主营品牌。

结果是两个判断源：Platform Intelligence 与 Workbench Local Intelligence。

## 4. Platform / Workbench 决策边界

| 职责 | 谁 |
|---|---|
| research / evidence / claim / public verdict / confidence / advice | Platform |
| 只读 quotation 聚合后作为 request context | Workbench |
| 格式化、排序、卡片 view model、empty / unknown、origin 标签 | Workbench |
| 人工 accept / reject / corrected_json | Workbench |
| 正式报告落库 | Workbench |
| 根据库存/询价/snippet 再推断热门缺货涨价授权主营 | **禁止** |

Platform 返回 `未知` → UI 必须继续 `未知`。  
内部 `advice.usedInternal` 单独展示，不混进公开市场结论。

## 5. buildMarketCards 分类

原函数同时做了：

- A. 展示映射（标题、三列卡片）
- B. 业务推断（热门 / 缺货 / 涨跌）

现已拆开：

- **保留** `analyzePart`：挂货条数、立创现货、价格数字的确定性聚合（行情对照，不是智能结论）
- **保留** 卡片 view model：title / verdict / detail / level / origin
- **停用** 本地 hot / shortage / price / combined advice 推断
- **新入口** `presentPartIntelligence`：Platform 成功则只格式化 Platform `verdict` / `cards` / `claims`
- claim 必须能在 `evidence[]` 找到 `evidenceId`；否则公开状态回落 `未知`

`buildMarketCards` 仍导出，但不再根据 `inquirers` 或库存改写结论。

## 6. Company evidence 规则

- 有 `claim.evidenceId` 且能在 `evidence[]` 找到 → 展示 text / source / url / confidence
- 无 evidence → unknown；不编联系人、注册资本、主营品牌、热卖型号、授权
- `profile.mainBrands` / `topMpns` 必须带 `evidenceId` 且能落到 evidence
- 搜索 snippet 只作为「搜索片段」展示，不升格为 claim
- 商铺页「经营品牌」标注为声明，不是已验证主营

## 7. fallback 规则

Platform 超时 / 401 / 5xx / 无效响应：

- 继续 Firecrawl / AnySearch / HQB 本地 lookup
- `intelligenceOrigin = fallback`
- `platformDegradation` 横幅：降级信息，不是 Platform Intelligence
- 公开市场卡片保持 unknown，不伪装成 evidence-backed

## 8. review / correction 边界

- `submitReportReview` 只写 Workbench `search_reports`
- `upsertReportRow` 不更新 `decision` / `review_note` / `corrected_json`
- 不把 review / corrected_json 回传 Platform
- 重新 research 使用新 report id，不覆盖旧报告的人工修正

## 9. Company Context 审计

| Context | 是否有业务价值 | 是否敏感 | 是否应该传 Platform |
|---|---|---|---|
| quotation count（该公司作为客户/供应商的询价条数） | 中：可提示「打过交道」 | 中：条数可，客户名/金额不可 | 本阶段否。公司查询主体是供应商名，现有 quotation 表按 MPN 聚合，对不上公司主键 |
| inquiry / quote 历史 | 中 | 高（客户名、内容） | 否 |
| known supplier/customer relation | 高，但当前无稳定公司 ID 关系表 | 中 | 否，先不要编关系 |
| research history（查过几次） | 低 | 低 | 否，对公开证据无帮助 |
| shopUrl / 已保存名片 | 低：Platform 自己会查 GYS | 低 | 否 |
| 内部备注 / 人工 corrected_json | 无（会污染公开 intelligence） | 高 | **禁止** |

结论：本阶段 **不新增 Company context**。Part 已有的 quotation 聚合保持。不要为了和 Part 对称而机械加字段。

## 10. 修改后链路

```
用户查询
  → Part: quotation context（只读聚合）→ POST /v1/parts/research
  → Company: POST /v1/companies/research（仍无 context）
  → 成功：normalize verdict / evidence / cards / profile / advice
       origin=platform
       presentPartIntelligence / presentCompanyIntelligence
       公开结论 = Platform；内部 advice 单独一栏
  → 失败：本地 lookup，origin=fallback，公开结论 unknown
  → Preview
  → Human Review（Workbench only）
  → Save payload；corrected_json 只由 review 写入
```

## 11. 测试证据

见 `tests/intelligence-presentation-boundary/`。
