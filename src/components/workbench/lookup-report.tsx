import { ArrowUpRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PartArchive } from "@/components/workbench/part-archive";
import { analyzePart, buildMarketCards, money, previousPartReport, stockText } from "@/lib/search/analyze";
import type { CompanyCard, LcscAlt, ShopRow } from "@/lib/search/md-parse";
import { summarizeCompanyInventory } from "@/lib/search/md-parse";
import { getReportReview, submitReportReview } from "@/lib/data/desk";
import type {
  IntelBrief,
  LiveOffer,
  PartIdentity,
  PlatformAdvice,
  PlatformDegradation,
  PlatformRecommendation,
  SourceStatus,
} from "@/lib/search/result-types";
import type { QuoteLine } from "@/lib/types";
import { useWorkbenchStore } from "@/lib/workbench-store";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export function LookupReport({
  kind,
  query,
  identity,
  alts,
  offers,
  companies,
  shopRows,
  steps,
  yunPrice,
  intel,
  advice,
  recommendation,
  platformDegradation,
  inquirers,
  exactOnly,
  onExactOnly,
  onSaveOffer,
  reportId,
}: {
  kind: "part" | "company";
  query: string;
  identity: PartIdentity | null;
  alts: LcscAlt[];
  offers: LiveOffer[];
  companies: CompanyCard[];
  shopRows: ShopRow[];
  steps: SourceStatus[];
  yunPrice: number | null;
  intel?: IntelBrief | null;
  advice?: PlatformAdvice | null;
  recommendation?: PlatformRecommendation | null;
  platformDegradation?: PlatformDegradation | null;
  inquirers: QuoteLine[];
  exactOnly: boolean;
  onExactOnly: (v: boolean) => void;
  onSaveOffer: (o: LiveOffer) => void;
  reportId?: string;
}) {
  const analysis = kind === "part" ? analyzePart(query, offers, identity, yunPrice) : null;
  const reportCache = useWorkbenchStore((s) => s.reportCache);
  const previous = kind === "part" ? previousPartReport(Object.values(reportCache), query) : null;
  const market =
    analysis && identity
      ? buildMarketCards({ analysis, identity, inquirers, previous })
      : analysis
        ? buildMarketCards({ analysis, identity, inquirers, previous })
        : [];
  const shopSummary = shopRows.length ? summarizeCompanyInventory(shopRows) : null;
  const visible =
    kind !== "part" || !exactOnly
      ? offers
      : offers.filter((o) => o.sourceKey === "lcsc" || o.model.toUpperCase() === query.toUpperCase());
  const stepLinks = steps.filter((s) => s.url);
  const qc = useQueryClient();
  const reviewQuery = useQuery({
    queryKey: ["report-review", reportId],
    queryFn: () => getReportReview({ data: { id: reportId ?? "" } }),
    enabled: Boolean(reportId),
    staleTime: 30_000,
  });
  const [reviewNote, setReviewNote] = useState("");
  const [correctedJson, setCorrectedJson] = useState("");
  const reviewMut = useMutation({
    mutationFn: (decision: "accept" | "reject" | "corrected") =>
      submitReportReview({
        data: {
          id: reportId ?? "",
          decision,
          note: reviewNote.trim() || undefined,
          correctedJson: decision === "corrected" && correctedJson.trim() ? correctedJson.trim() : undefined,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["report-review", reportId] });
      if (r.ok) {
        setReviewNote("");
        setCorrectedJson("");
        toast.success("人工决定已保存（工作台持有）");
      } else {
        toast.error(r.error || "保存决定失败");
      }
    },
  });

  return (
    <div className="grid gap-5">
      {platformDegradation ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">本地查询结果</h3>
          <p className="mt-1 text-xs text-muted">已使用本地数据。平台智能分析本次未参与，事实、写库和最终决定仍由工作台与人工负责。</p>
        </section>
      ) : null}

      {identity ? <PartArchive identity={identity} alts={alts} intel={intel} /> : null}

      {kind === "company" && intel?.hits.length ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">公开介绍</h3>
          <p className="mt-1 text-xs text-muted">AnySearch 公开页，只保留公司全名对得上的结果。不是库存。</p>
          {intel.summary && !identity ? (
            <p className="mt-3 text-sm leading-relaxed">{intel.summary}</p>
          ) : null}
          <ul className="mt-3 grid gap-2">
            {intel.hits.slice(0, 8).map((h) => (
              <li key={h.url || h.title} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                {h.url ? (
                  <a href={h.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">
                    {h.title || h.url}
                    <ArrowUpRight className="ml-1 inline size-3.5" />
                  </a>
                ) : (
                  <p className="text-sm font-medium">{h.title}</p>
                )}
                {h.snippet ? <p className="mt-1 text-xs leading-relaxed text-muted">{h.snippet}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {kind === "part" && advice?.usedInternal ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">内部业务建议</h3>
          <p className="mt-1 text-xs text-muted">基于本工作台的汇总询价上下文，不是公开市场证据或成交结论。</p>
          <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-3">
            <p className="text-sm font-semibold">{advice.action || recommendation?.action || "人工确认后报价"}</p>
            {advice.internalView ? <p className="mt-2 text-xs leading-relaxed text-muted">{advice.internalView}</p> : null}
            {advice.combined ? <p className="mt-2 text-xs leading-relaxed text-muted">{advice.combined}</p> : null}
          </div>
        </section>
      ) : null}

      {market.length ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">市场观察</h3>
          <p className="mt-1 text-xs text-muted">
            热门 / 货 / 价来自立创现货、华强挂货和你自己的询价记录，不是烽火指数。
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {market.map((c) => (
              <div key={c.key} className="rounded-lg border border-line bg-surface-2 px-3 py-3">
                <p className="text-xs text-muted">{c.title}</p>
                <p className="mt-1 text-sm font-semibold">{c.verdict}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted">{c.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {analysis ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">行情对照</h3>
          <p className="mt-1 text-xs text-muted">
            立创是商城现货价。华强挂货是询价信息，不是成交库存、不是烽火指数。
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="立创现货"
              value={analysis.lcscStock != null ? stockText(analysis.lcscStock) : "—"}
              hint={analysis.lcscPrice != null ? `1+ ${money(analysis.lcscPrice)}` : "未取到价"}
            />
            <Stat
              label="本型号挂货"
              value={`${analysis.offerCount} 条`}
              hint={`合计库存 ${stockText(analysis.totalStock)}`}
            />
            <Stat
              label="挂货最低价"
              value={money(analysis.minPrice)}
              hint={
                analysis.medianPrice != null
                  ? `中位 ${money(analysis.medianPrice)} · ${analysis.priced} 条有价`
                  : "多数写询价"
              }
            />
            <Stat
              label="相对立创 1+"
              value={
                analysis.spread == null
                  ? "—"
                  : analysis.spread === 0
                    ? "持平"
                    : analysis.spread > 0
                      ? `低 ${money(analysis.spread)}`
                      : `高 ${money(-analysis.spread)}`
              }
              hint={analysis.yunPrice != null ? `华强云价格 ${money(analysis.yunPrice)}` : "挂价，不是成交"}
            />
          </div>

          {analysis.lcscBreaks.length ? (
            <div className="mt-5">
              <p className="text-xs text-muted">立创阶梯价</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[360px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1.5 font-medium">起订</th>
                      <th className="py-1.5 font-medium">单价</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.lcscBreaks.map((p) => (
                      <tr key={p.qty} className="border-t border-line">
                        <td className="py-1.5 tabular-nums">{p.qty}+</td>
                        <td className="py-1.5 tabular-nums">{money(p.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {analysis.batches.length ? (
            <div className="mt-5">
              <p className="text-xs text-muted">批号结构（挂货）</p>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {analysis.batches.slice(0, 8).map((b) => (
                  <li key={b.label} className="flex justify-between text-sm">
                    <span>{b.label}</span>
                    <span className="tabular-nums text-muted">
                      {b.count} 家 · 库存 {stockText(b.stock)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.suppliers.length ? (
            <div className="mt-5">
              <p className="text-xs text-muted">挂货库存靠前的供应商</p>
              <ul className="mt-2 grid gap-2">
                {analysis.suppliers.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1">{s.name}</span>
                    <span className="tabular-nums text-muted">
                      {stockText(s.stock)} · {money(s.price)}
                      {s.batch ? ` · ${s.batch}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {inquirers.length ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">谁在询这颗料</h3>
          <ul className="mt-3 grid gap-2">
            {inquirers.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {q.customer} × {q.mpn}
                </span>
                <Badge variant={q.status === "已完成" ? "done" : q.status === "已报价" ? "progress" : "pending"}>
                  {q.status}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {alts.length ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">立创替代 / 相似料</h3>
          <p className="mt-1 text-xs text-muted">从立创商品页抽出，用来对照库存和价，不是推荐替换方案。</p>
          <ul className="mt-3 grid gap-2 text-sm">
            {alts.slice(0, 12).map((a) => (
              <li
                key={a.mpn}
                className="flex flex-wrap justify-between gap-2 border-b border-line py-2 last:border-0"
              >
                <span>
                  {a.mpn} <span className="text-muted">{a.brand}</span>
                  {a.package ? <span className="text-faint"> · {a.package}</span> : null}
                </span>
                <span className="tabular-nums text-muted">
                  {stockText(a.stock)} · {money(a.price)}
                  {a.similarity ? ` · ${a.similarity}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {companies.length ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">供应商名片</h3>
          <ul className="mt-3 grid gap-3">
            {companies.map((c) => (
              <li key={c.name} className="rounded-lg border border-line bg-surface-2 p-3">
                <a
                  href={c.shopUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium hover:underline"
                >
                  {c.name}
                </a>
                <p className="mt-1 text-xs text-muted">
                  {c.memberYears ? `会员 ${c.memberYears} 年` : ""}
                  {c.founded ? ` 成立 ${c.founded}` : ""}
                </p>
                {c.brands.length ? (
                  <p className="mt-2 text-xs text-muted">声明品牌 {c.brands.slice(0, 10).join("、")}</p>
                ) : null}
                {c.categories.length ? (
                  <p className="mt-1 text-xs text-faint">品类 {c.categories.slice(0, 8).join("、")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {shopSummary ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">库存品牌结构</h3>
          <p className="mt-1 text-xs text-muted">
            第一页 {shopSummary.totalRows} 条，{shopSummary.totalModels} 个型号。公开挂货，不是成交热卖。
          </p>
          <ul className="mt-3 grid gap-2 text-sm">
            {shopSummary.byBrand.slice(0, 10).map((b) => (
              <li key={b.brand} className="flex justify-between gap-3">
                <span>{b.brand}</span>
                <span className="tabular-nums text-muted">
                  {b.modelCount} 型号 · {stockText(b.stock)}
                </span>
              </li>
            ))}
          </ul>
          {shopSummary.topModels.length ? (
            <div className="mt-5">
              <p className="text-xs text-muted">这一页库存靠前的型号</p>
              <ul className="mt-2 grid gap-2 text-sm">
                {shopSummary.topModels.slice(0, 10).map((m) => (
                  <li key={m.model} className="flex justify-between gap-3">
                    <span>
                      {m.model} <span className="text-muted">{m.brand}</span>
                    </span>
                    <span className="tabular-nums text-muted">{stockText(m.stock)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {kind === "part" && offers.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onExactOnly(true)}
            className={
              exactOnly
                ? "h-9 rounded-full border border-accent bg-accent px-3 text-xs text-accent-fg"
                : "h-9 rounded-full border border-line bg-surface px-3 text-xs text-muted"
            }
          >
            只看本型号
          </button>
          <button
            type="button"
            onClick={() => onExactOnly(false)}
            className={
              !exactOnly
                ? "h-9 rounded-full border border-accent bg-accent px-3 text-xs text-accent-fg"
                : "h-9 rounded-full border border-line bg-surface px-3 text-xs text-muted"
            }
          >
            含替代/广告
          </button>
          <span className="text-xs text-muted tabular-nums">{visible.length} 条</span>
        </div>
      ) : null}

      {visible.length ? (
        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">来源</th>
                  <th className="px-3 py-2 font-medium">供应商</th>
                  <th className="px-3 py-2 font-medium">型号</th>
                  <th className="px-3 py-2 font-medium">品牌</th>
                  <th className="px-3 py-2 font-medium">批号</th>
                  <th className="px-3 py-2 font-medium">库存</th>
                  <th className="px-3 py-2 font-medium">价格</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o, i) => (
                  <tr key={`${o.sourceKey}-${o.supplier}-${i}`} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 text-xs text-muted">{o.sourceName}</td>
                    <td className="px-3 py-2">{o.supplier}</td>
                    <td className="px-3 py-2 font-medium">{o.model}</td>
                    <td className="px-3 py-2 text-muted">{o.brand}</td>
                    <td className="px-3 py-2 text-muted">{o.batch || "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{stockText(o.stock)}</td>
                    <td className="px-3 py-2 tabular-nums">{o.currency === "USD" ? `$${o.price?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : money(o.price)}</td>
                    <td className="px-3 py-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => onSaveOffer(o)}>
                        记待办
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="grid gap-3 p-3 md:hidden">
            {visible.map((o, i) => (
              <li key={`${o.sourceKey}-${i}`} className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted">{o.sourceName}</p>
                    <p className="mt-0.5 text-sm font-semibold">{o.model}</p>
                    <p className="mt-1 text-xs text-muted">{o.supplier}</p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => onSaveOffer(o)}>
                    记待办
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {o.batch ? `${o.batch} · ` : ""}库存 {stockText(o.stock)} · {o.currency === "USD" ? `$${o.price?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : money(o.price)}{o.currency === "USD" ? " (USD)" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stepLinks.length ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">出处</h3>
          <p className="mt-1 text-xs text-muted">点开当时抓过的页面，核对原文。</p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {stepLinks.map((s) => (
              <a
                key={s.key}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 items-center justify-between rounded-md border border-line bg-surface-2 px-3 text-sm hover:bg-bg"
              >
                <span>
                  {s.name}
                  <span className="ml-2 text-xs text-muted">
                    {s.status === "ok" ? `${s.count} 条` : s.error || s.status}
                  </span>
                </span>
                <ArrowUpRight className="size-4 text-faint" />
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {reportId ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h3 className="text-sm font-semibold">人工决定</h3>
          <p className="mt-1 text-xs text-muted">由工作台持久化最终动作；平台不写正式业务决定。</p>
          {reviewQuery.data?.decision ? (
            <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              已决定：
              {reviewQuery.data.decision === "accept"
                ? "接受"
                : reviewQuery.data.decision === "reject"
                  ? "拒绝"
                  : "修正"}
              {reviewQuery.data.reviewed_at
                ? ` · ${new Date(reviewQuery.data.reviewed_at).toLocaleString("zh-CN", { hour12: false })}`
                : ""}
              {reviewQuery.data.review_note ? ` · ${reviewQuery.data.review_note}` : ""}
              {reviewQuery.data.corrected_json ? " · 已保存修正内容" : ""}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => reviewMut.mutate("accept")} disabled={reviewMut.isPending}>
              接受此报告
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => reviewMut.mutate("reject")} disabled={reviewMut.isPending}>
              拒绝此报告
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                if (!correctedJson.trim()) {
                  toast.error("修正需要填写修正后的 JSON");
                  return;
                }
                reviewMut.mutate("corrected");
              }}
              disabled={reviewMut.isPending}
            >
              提交修正
            </Button>
          </div>
          <Textarea
            value={correctedJson}
            onChange={(e) => setCorrectedJson(e.target.value)}
            placeholder="修正后的报告 JSON（提交修正时必填）"
            className="mt-3 min-h-[64px] font-mono text-xs"
          />
          <Textarea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            placeholder="备注（可选）"
            className="mt-3 min-h-[40px] text-xs"
          />
        </section>
      ) : null}
    </div>
  );
}
