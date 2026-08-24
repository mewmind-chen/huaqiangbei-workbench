import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { CustomerBook } from "@/components/workbench/customer-book";
import { LookupHistory } from "@/components/workbench/lookup-history";
import { LookupReport } from "@/components/workbench/lookup-report";
import { PartsPool } from "@/components/workbench/parts-pool";
import { QuoteBoard } from "@/components/workbench/quote-board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { nowLocal } from "@/lib/dates";
import { parseYunPrice } from "@/lib/search/analyze";
import { researchViaPlatform } from "@/lib/search/agent-platform";
import {
  lookupStep,
  type IntelBrief,
  type LiveOffer,
  type PartIdentity,
  type SourceStatus,
} from "@/lib/search/live-lookup";
import type { CompanyCard, LcscAlt, ShopRow } from "@/lib/search/md-parse";
import { detectQuery } from "@/lib/search/md-parse";
import type { LookupRecord } from "@/lib/search/result-types";
import { useTodoStore } from "@/lib/todo-store";
import type { SearchTab } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkbenchStore } from "@/lib/workbench-store";

const SEARCH_TABS: { id: SearchTab; label: string }[] = [
  { id: "lookup", label: "查询" },
  { id: "history", label: "记录" },
  { id: "quotes", label: "待报价" },
  { id: "parts", label: "型号池" },
  { id: "customers", label: "客户" },
];

const PART_STEPS: { key: "lcsc" | "st" | "hqew" | "intel" | "findchips" | "icnet"; name: string }[] = [
  { key: "lcsc", name: "立创商品页" },
  { key: "st", name: "原厂应用" },
  { key: "hqew", name: "华强挂货" },
  { key: "intel", name: "公开资料" },
  { key: "findchips", name: "海外分销" },
  { key: "icnet", name: "IC交易网" },
];

const COMPANY_STEPS: { key: "gys" | "shop" | "intel"; name: string }[] = [
  { key: "gys", name: "华强供应商" },
  { key: "shop", name: "商铺库存" },
  { key: "intel", name: "公开资料" },
];

function mergeIdentity(a: PartIdentity | null, b?: PartIdentity): PartIdentity | null {
  if (!b) return a;
  if (!a) return b;
  const apps = [...a.applications, ...b.applications].filter(Boolean);
  return {
    mpn: a.mpn || b.mpn,
    brand: a.brand || b.brand,
    category: a.category || b.category,
    package: a.package || b.package,
    desc: a.desc || b.desc,
    summary: a.summary || b.summary,
    features: a.features || b.features,
    lcscCode: a.lcscCode || b.lcscCode,
    specs: a.specs?.length ? a.specs : b.specs || [],
    applications: [...new Set(apps)],
    longevity: a.longevity || b.longevity,
    active: a.active || b.active,
    lcscStock: a.lcscStock ?? b.lcscStock,
    priceBreaks: a.priceBreaks.length ? a.priceBreaks : b.priceBreaks,
    lcscUrl: a.lcscUrl || b.lcscUrl,
    stUrl: a.stUrl || b.stUrl,
  };
}

function applyRecord(
  record: LookupRecord,
  set: {
    raw: (v: string) => void;
    picked: (v: string | null) => void;
    kind: (v: "part" | "company") => void;
    queryUsed: (v: string) => void;
    identity: (v: PartIdentity | null) => void;
    alts: (v: LcscAlt[]) => void;
    offers: (v: LiveOffer[]) => void;
    companies: (v: CompanyCard[]) => void;
    shopRows: (v: ShopRow[]) => void;
    steps: (v: SourceStatus[]) => void;
    yunPrice: (v: number | null) => void;
    intel: (v: IntelBrief | null) => void;
  },
) {
  set.raw(record.query);
  set.picked(record.query);
  set.kind(record.kind);
  set.queryUsed(record.query);
  set.identity(record.identity);
  set.alts(record.alts);
  set.offers(record.offers);
  set.companies(record.companies);
  set.shopRows(record.shopRows);
  set.steps(record.steps);
  set.yunPrice(record.yunPrice);
  set.intel(record.intel || null);
}

function LookupView() {
  const addItem = useTodoStore((s) => s.addItem);
  const addPart = useWorkbenchStore((s) => s.addPart);
  const inquirersFor = useWorkbenchStore((s) => s.inquirersFor);
  const pendingLookup = useWorkbenchStore((s) => s.pendingLookup);
  const consumePendingLookup = useWorkbenchStore((s) => s.consumePendingLookup);
  const pendingReport = useWorkbenchStore((s) => s.pendingReport);
  const consumePendingReport = useWorkbenchStore((s) => s.consumePendingReport);
  const saveReport = useWorkbenchStore((s) => s.saveReport);
  const reports = useWorkbenchStore((s) => s.reports);
  const openReport = useWorkbenchStore((s) => s.openReport);

  const [raw, setRaw] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"part" | "company">("part");
  const [steps, setSteps] = useState<SourceStatus[]>([]);
  const [identity, setIdentity] = useState<PartIdentity | null>(null);
  const [alts, setAlts] = useState<LcscAlt[]>([]);
  const [offers, setOffers] = useState<LiveOffer[]>([]);
  const [companies, setCompanies] = useState<CompanyCard[]>([]);
  const [shopRows, setShopRows] = useState<ShopRow[]>([]);
  const [exactOnly, setExactOnly] = useState(true);
  const [queryUsed, setQueryUsed] = useState("");
  const [yunPrice, setYunPrice] = useState<number | null>(null);
  const [scrapeKey, setScrapeKey] = useState("");
  const [intel, setIntel] = useState<IntelBrief | null>(null);

  useEffect(() => {
    try {
      setScrapeKey(localStorage.getItem("workbench-scrape-key") || "");
    } catch {
      /* ignore */
    }
  }, []);

  function persistScrapeKey(v: string) {
    setScrapeKey(v);
    try {
      if (v.trim()) localStorage.setItem("workbench-scrape-key", v.trim());
      else localStorage.removeItem("workbench-scrape-key");
    } catch {
      /* ignore */
    }
  }

  const setters = {
    raw: setRaw,
    picked: setPicked,
    kind: setKind,
    queryUsed: setQueryUsed,
    identity: setIdentity,
    alts: setAlts,
    offers: setOffers,
    companies: setCompanies,
    shopRows: setShopRows,
    steps: setSteps,
    yunPrice: setYunPrice,
    intel: setIntel,
  };

  const detected = useMemo(() => detectQuery(raw), [raw]);
  const query = picked || (detected.candidates.length === 1 ? detected.candidates[0] : "");
  const inquirers = queryUsed ? inquirersFor(queryUsed) : [];
  const hasReport = Boolean(queryUsed && (identity || offers.length || companies.length || shopRows.length || intel));

  useEffect(() => {
    if (!pendingReport) return;
    const row = pendingReport;
    consumePendingReport();
    applyRecord(row, setters);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReport]);

  useEffect(() => {
    if (!pendingLookup) return;
    setRaw(pendingLookup.query);
    setPicked(pendingLookup.query);
    setKind(pendingLookup.kind);
    const next = pendingLookup;
    consumePendingLookup();
    void runLookup(next.query, next.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLookup]);

  async function runLookup(forcedQuery?: string, forcedKind?: "part" | "company") {
    const q = (forcedQuery || query).trim();
    const k = forcedKind || (detected.kind === "company" && !picked ? "company" : "part");
    if (!q) {
      toast.error(detected.candidates.length > 1 ? "一次只查一个，请先点选" : "请输入型号或公司名");
      return;
    }
    setBusy(true);
    setKind(k);
    setQueryUsed(q);
    setIdentity(null);
    setAlts([]);
    setOffers([]);
    setCompanies([]);
    setShopRows([]);
    setYunPrice(null);
    setIntel(null);
    const plan = k === "company" ? COMPANY_STEPS : PART_STEPS;
    setSteps(plan.map((s) => ({ key: s.key, name: s.name, url: "", status: "searching", count: 0 })));
    try {
      const platform = await researchViaPlatform({
        data: { query: q, kind: k, scrapeKey: scrapeKey.trim() || undefined },
      });
      if (platform && (platform.identity || platform.offers.length || platform.companies.length || platform.shopRows.length)) {
        setSteps(platform.steps);
        setIdentity(platform.identity);
        setAlts(platform.alts);
        setOffers(platform.offers);
        setCompanies(platform.companies);
        setShopRows(platform.shopRows);
        setYunPrice(platform.yunPrice);
        setIntel(platform.intel);
        saveReport({
          id: crypto.randomUUID(),
          query: q,
          kind: k,
          createdAt: nowLocal(),
          yunPrice: platform.yunPrice,
          identity: platform.identity,
          alts: platform.alts.slice(0, 12),
          offers: platform.offers,
          companies: platform.companies,
          shopRows: platform.shopRows,
          steps: platform.steps,
          intel: platform.intel,
        });
        toast.success(`已记下 ${q} 的分析`);
        return;
      }
      if (k === "part") {
        const results = await Promise.all(
          PART_STEPS.map((s) =>
            lookupStep({
              data: { query: q, step: s.key, kind: "part", scrapeKey: scrapeKey.trim() || undefined },
            }),
          ),
        );
        let ident: PartIdentity | null = null;
        const nextOffers: LiveOffer[] = [];
        const nextAlts: LcscAlt[] = [];
        let yun: number | null = null;
        let nextIntel: IntelBrief | null = null;
        const nextSteps: SourceStatus[] = PART_STEPS.map((s, i) => {
          const r = results[i];
          if (!r.ok) {
            return { key: s.key, name: s.name, url: "", status: "error" as const, error: r.error, count: 0 };
          }
          ident = mergeIdentity(ident, r.identity);
          if (r.alts?.length) nextAlts.push(...r.alts);
          if (r.offers?.length) nextOffers.push(...r.offers);
          if (r.intel) nextIntel = r.intel;
          if (s.key === "hqew") yun = parseYunPrice(r.detail);
          return {
            key: s.key,
            name: s.name,
            url: r.url,
            status: r.status,
            error: r.detail,
            count: r.intel?.hits.length || r.offers?.length || r.alts?.length || (r.identity ? 1 : 0),
          };
        });
        setSteps(nextSteps);
        setIdentity(ident);
        setAlts(nextAlts);
        setOffers(nextOffers);
        setYunPrice(yun);
        setIntel(nextIntel);
        saveReport({
          id: crypto.randomUUID(),
          query: q,
          kind: "part",
          createdAt: nowLocal(),
          yunPrice: yun,
          identity: ident,
          alts: nextAlts.slice(0, 12),
          offers: nextOffers,
          companies: [],
          shopRows: [],
          steps: nextSteps,
          intel: nextIntel,
        });
        toast.success(`已记下 ${q} 的分析`);
      } else {
        const [gys, intelRes] = await Promise.all([
          lookupStep({ data: { query: q, step: "gys", scrapeKey: scrapeKey.trim() || undefined } }),
          lookupStep({ data: { query: q, step: "intel", kind: "company" } }),
        ]);
        let shopUrl = "";
        let nextCompanies: CompanyCard[] = [];
        let nextIntel: IntelBrief | null = intelRes.ok ? intelRes.intel || null : null;
        let gysStep: SourceStatus = { key: "gys", name: "华强供应商", url: "", status: "error", count: 0 };
        let intelStep: SourceStatus = intelRes.ok
          ? {
              key: "intel",
              name: "公开资料",
              url: intelRes.url,
              status: intelRes.status,
              count: intelRes.intel?.hits.length || 0,
              error: intelRes.detail,
            }
          : { key: "intel", name: "公开资料", url: "", status: "error", error: intelRes.error, count: 0 };
        if (gys.ok) {
          nextCompanies = gys.companies || [];
          shopUrl = nextCompanies.find((c) => c.matched && c.shopUrl)?.shopUrl || "";
          gysStep = { key: "gys", name: "华强供应商", url: gys.url, status: gys.status, count: nextCompanies.length };
          setCompanies(nextCompanies);
        } else {
          gysStep = { key: "gys", name: "华强供应商", url: "", status: "error", error: gys.error, count: 0 };
        }
        setIntel(nextIntel);
        setSteps([gysStep, { key: "shop", name: "商铺库存", url: "", status: "searching", count: 0 }, intelStep]);
        const shop = await lookupStep({
          data: { query: q, step: "shop", shopUrl, scrapeKey: scrapeKey.trim() || undefined },
        });
        let nextShop: ShopRow[] = [];
        let nextOffers: LiveOffer[] = [];
        let shopStep: SourceStatus = { key: "shop", name: "商铺库存", url: "", status: "error", count: 0 };
        if (shop.ok) {
          nextShop = shop.shopRows || [];
          nextOffers = shop.offers || [];
          shopStep = {
            key: "shop",
            name: "商铺库存",
            url: shop.url,
            status: shop.status,
            count: nextShop.length,
            error: shop.detail,
          };
          setShopRows(nextShop);
          setOffers(nextOffers);
        } else {
          shopStep = { key: "shop", name: "商铺库存", url: "", status: "error", error: shop.error, count: 0 };
        }
        const nextSteps = [gysStep, shopStep, intelStep];
        setSteps(nextSteps);
        saveReport({
          id: crypto.randomUUID(),
          query: q,
          kind: "company",
          createdAt: nowLocal(),
          yunPrice: null,
          identity: null,
          alts: [],
          offers: nextOffers,
          companies: nextCompanies,
          shopRows: nextShop,
          steps: nextSteps,
          intel: nextIntel,
        });
        toast.success(`已记下 ${q} 的分析`);
      }
    } finally {
      setBusy(false);
    }
  }

  function saveOffer(o: LiveOffer) {
    addItem({
      customer: o.supplier || "待定客户",
      type: "报价",
      content: `${o.model}${o.brand ? ` ${o.brand}` : ""}${o.stock != null ? ` 库存 ${o.stock}` : ""} ${o.price != null ? `¥${o.price}` : "询价"} · ${o.sourceName}`,
      amount: o.price,
      dueAt: null,
    });
    toast.success("已记入报价待办");
  }

  function saveQueryTodo() {
    addItem({
      customer: kind === "company" ? queryUsed : "待定客户",
      type: "报价",
      content: kind === "part" ? `查价 ${queryUsed}` : `了解 ${queryUsed} 公开货源`,
      amount: identity?.priceBreaks[0]?.price ?? null,
      dueAt: null,
    });
    toast.success("已生成报价待办");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="grid h-fit gap-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">步骤</h2>
        <ol className="grid gap-2">
          {(kind === "company" ? COMPANY_STEPS : PART_STEPS).map((s) => {
            const row = steps.find((x) => x.key === s.key);
            const st = row?.status || "pending";
            return (
              <li key={s.key} className="rounded-md border border-line bg-surface-2 px-3 py-2">
                <p className="text-sm">{s.name}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {st === "searching"
                    ? "大约十几秒…"
                    : st === "ok"
                      ? `完成 ${row?.count || 0} 条`
                      : st === "skipped"
                        ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="max-w-[170px] truncate">{row?.error || "跳过"}</span>
                            {row?.url ? (
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 font-medium text-accent hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                打开 ↗
                              </a>
                            ) : null}
                          </span>
                        )
                        : st === "error"
                          ? row?.error || "失败"
                          : st === "empty"
                            ? "无结构化行"
                            : "等待"}
                </p>
              </li>
            );
          })}
        </ol>
        {queryUsed ? (
          <Button type="button" size="sm" variant="secondary" onClick={saveQueryTodo}>
            记为待办
          </Button>
        ) : null}
        {identity ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              addPart({
                mpn: identity.mpn,
                brand: identity.brand,
                category: identity.category,
              });
              toast.success("已加入主推池");
            }}
          >
            加入主推池
          </Button>
        ) : null}
      </aside>

      <div className="grid gap-5">
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <p className="text-xs text-muted">
            一次只查一个。分析会留下记录。挂货是询价信息，不是成交库存。
          </p>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5">
              <Label>型号或公司名</Label>
              <Textarea
                rows={3}
                placeholder="例如 STM32F103C8T6，或公司全名"
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setPicked(null);
                }}
              />
            </label>
            <label className="grid gap-1.5">
              <Label>抓取 Key</Label>
              <Input
                type="password"
                autoComplete="off"
                placeholder="出现查询不可用时填写，只存在这台浏览器"
                value={scrapeKey}
                onChange={(e) => persistScrapeKey(e.target.value)}
              />
            </label>
            {detected.candidates.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {detected.candidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPicked(c)}
                    className={cn(
                      "h-9 rounded-full border px-3 text-xs",
                      picked === c
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-line bg-surface-2 text-ink",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
            <Button type="button" onClick={() => void runLookup()} disabled={busy}>
              <Search className="size-4" />
              {busy ? "分析中，大约十几秒…" : "开始分析"}
            </Button>
          </div>
          {!hasReport && reports.length ? (
            <div className="mt-4">
              <p className="text-xs text-muted">最近查过</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {reports.slice(0, 6).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openReport(r.id)}
                    className="h-9 rounded-full border border-line bg-surface-2 px-3 text-xs hover:text-ink"
                  >
                    {r.query}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {hasReport ? (
          <LookupReport
            kind={kind}
            query={queryUsed}
            identity={identity}
            alts={alts}
            offers={offers}
            companies={companies}
            shopRows={shopRows}
            steps={steps}
            yunPrice={yunPrice}
            intel={intel}
            inquirers={inquirers}
            exactOnly={exactOnly}
            onExactOnly={setExactOnly}
            onSaveOffer={saveOffer}
          />
        ) : null}
      </div>
    </div>
  );
}

export function SearchPanel() {
  const searchTab = useWorkbenchStore((s) => s.searchTab);
  const setSearchTab = useWorkbenchStore((s) => s.setSearchTab);
  const openQuotes = useWorkbenchStore((s) => s.quotes.filter((q) => q.status !== "已完成").length);
  const reportCount = useWorkbenchStore((s) => s.reports.length);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-1">
        {SEARCH_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSearchTab(item.id)}
            className={cn(
              "h-10 rounded-md px-4 text-sm font-medium",
              searchTab === item.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface hover:text-ink",
            )}
          >
            {item.label}
            {item.id === "quotes" && openQuotes ? ` ${openQuotes}` : ""}
            {item.id === "history" && reportCount ? ` ${reportCount}` : ""}
          </button>
        ))}
      </div>
      {searchTab === "lookup" ? <LookupView /> : null}
      {searchTab === "history" ? <LookupHistory /> : null}
      {searchTab === "quotes" ? <QuoteBoard /> : null}
      {searchTab === "parts" ? <PartsPool /> : null}
      {searchTab === "customers" ? <CustomerBook /> : null}
    </div>
  );
}
