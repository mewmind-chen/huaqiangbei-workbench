import { create } from "zustand";
import {
  getReport,
  removeCustomerRow,
  removePartRow,
  removeReportRow,
  upsertCustomer,
  upsertPart,
  upsertQuote,
  upsertQuotes,
  upsertReport,
} from "@/lib/data/desk";
import { nowLocal } from "@/lib/dates";
import { reportSummary } from "@/lib/search/analyze";
import { detectQuery } from "@/lib/search/md-parse";
import type { LookupRecord } from "@/lib/search/result-types";
import type {
  CustomerRecord,
  MainTab,
  PooledPart,
  QuoteLine,
  QuoteStatus,
  ReportSummary,
  SearchTab,
  TodoItem,
} from "@/lib/types";

type PendingLookup = { query: string; kind: "part" | "company" } | null;

type State = {
  mainTab: MainTab;
  searchTab: SearchTab;
  pendingLookup: PendingLookup;
  pendingReport: LookupRecord | null;
  quotes: QuoteLine[];
  parts: PooledPart[];
  customers: CustomerRecord[];
  reports: ReportSummary[];
  reportCache: Record<string, LookupRecord>;
  setMainTab: (tab: MainTab) => void;
  setSearchTab: (tab: SearchTab) => void;
  hydrate: (input: {
    quotes: QuoteLine[];
    parts: PooledPart[];
    customers: CustomerRecord[];
    reports: ReportSummary[];
  }) => void;
  openLookup: (query: string, kind?: "part" | "company") => void;
  consumePendingLookup: () => PendingLookup;
  saveReport: (record: LookupRecord) => void;
  openReport: (id: string) => void;
  consumePendingReport: () => LookupRecord | null;
  removeReport: (id: string) => void;
  captureFromItem: (item: TodoItem) => QuoteLine[];
  closeByItemId: (itemId: string) => void;
  closeFromItem: (item: TodoItem) => void;
  setQuoteStatus: (id: string, status: QuoteStatus) => void;
  addPart: (input: { mpn: string; brand?: string; category?: string; notes?: string }) => PooledPart | null;
  removePart: (id: string) => void;
  addCustomer: (name: string) => CustomerRecord | null;
  removeCustomer: (id: string) => void;
  backfill: (items: TodoItem[]) => void;
  inquirersFor: (mpn: string) => QuoteLine[];
};

function uid() {
  return crypto.randomUUID();
}

function extractMpns(text: string) {
  const d = detectQuery(text);
  return d.kind === "part" ? d.candidates : [];
}

function toSummary(record: LookupRecord): ReportSummary {
  return {
    id: record.id,
    query: record.query,
    kind: record.kind,
    createdAt: record.createdAt,
    summary: reportSummary(record.kind, record.identity, record.offers),
  };
}

export const useWorkbenchStore = create<State>()((set, get) => ({
  mainTab: "todo",
  searchTab: "lookup",
  pendingLookup: null,
  pendingReport: null,
  quotes: [],
  parts: [],
  customers: [],
  reports: [],
  reportCache: {},
  setMainTab: (tab) => set({ mainTab: tab }),
  setSearchTab: (tab) => set({ searchTab: tab }),
  hydrate: (input) =>
    set({
      quotes: input.quotes,
      parts: input.parts,
      customers: input.customers,
      reports: input.reports,
    }),
  openLookup: (query, kind) => {
    const detected = detectQuery(query);
    set({
      mainTab: "search",
      searchTab: "lookup",
      pendingLookup: { query, kind: kind || detected.kind },
      pendingReport: null,
    });
  },
  consumePendingLookup: () => {
    const pending = get().pendingLookup;
    set({ pendingLookup: null });
    return pending;
  },
  saveReport: (record) => {
    const summary = toSummary(record);
    set({
      reports: [summary, ...get().reports.filter((r) => r.id !== record.id)].slice(0, 50),
      reportCache: { ...get().reportCache, [record.id]: record },
    });
    void upsertReport({ data: record }).catch((err) => console.error(err));
  },
  openReport: (id) => {
    const cached = get().reportCache[id];
    if (cached) {
      set({ mainTab: "search", searchTab: "lookup", pendingReport: cached, pendingLookup: null });
      return;
    }
    void getReport({ data: { id } })
      .then((row) => {
        if (!row) return;
        set({
          mainTab: "search",
          searchTab: "lookup",
          pendingReport: row,
          pendingLookup: null,
          reportCache: { ...get().reportCache, [id]: row },
        });
      })
      .catch((err) => console.error(err));
  },
  consumePendingReport: () => {
    const row = get().pendingReport;
    set({ pendingReport: null });
    return row;
  },
  removeReport: (id) => {
    const cache = { ...get().reportCache };
    delete cache[id];
    set({ reports: get().reports.filter((r) => r.id !== id), reportCache: cache });
    void removeReportRow({ data: { id } }).catch((err) => console.error(err));
  },
  captureFromItem: (item) => {
    if (item.type !== "报价") return [];
    const name = item.customer.trim();
    if (!name) return [];
    const mpns = extractMpns(item.content);
    const created: QuoteLine[] = [];
    set((state) => {
      let quotes = [...state.quotes];
      let customers = [...state.customers];
      if (!customers.some((c) => c.name === name)) {
        const customer = { id: uid(), name, createdAt: nowLocal() };
        customers = [customer, ...customers];
        void upsertCustomer({ data: customer }).catch((err) => console.error(err));
      }
      for (const mpn of mpns) {
        const existing = quotes.find(
          (q) => q.customer === name && q.mpn === mpn && (q.status === "待报价" || q.status === "已报价"),
        );
        if (existing) {
          quotes = quotes.map((q) =>
            q.id === existing.id
              ? { ...q, itemId: item.id, content: item.content.slice(0, 500), updatedAt: nowLocal() }
              : q,
          );
          const row = quotes.find((q) => q.id === existing.id);
          if (row) {
            created.push(row);
            void upsertQuote({ data: row }).catch((err) => console.error(err));
          }
          continue;
        }
        const row: QuoteLine = {
          id: uid(),
          customer: name,
          mpn,
          itemId: item.id,
          status: "待报价",
          content: item.content.slice(0, 500),
          createdAt: nowLocal(),
          updatedAt: nowLocal(),
        };
        quotes = [row, ...quotes];
        created.push(row);
        void upsertQuote({ data: row }).catch((err) => console.error(err));
      }
      return { quotes, customers };
    });
    return created;
  },
  closeByItemId: (itemId) => {
    const next = get().quotes.map((q) =>
      q.itemId === itemId && (q.status === "待报价" || q.status === "已报价")
        ? { ...q, status: "已完成" as const, updatedAt: nowLocal() }
        : q,
    );
    const changed = next.filter((q, i) => q.status !== get().quotes[i]?.status);
    set({ quotes: next });
    if (changed.length) void upsertQuotes({ data: changed }).catch((err) => console.error(err));
  },
  closeFromItem: (item) => {
    const mpns = extractMpns(item.content);
    const prev = get().quotes;
    const next = prev.map((q) => {
      const hit = q.itemId === item.id || (q.customer === item.customer && mpns.includes(q.mpn));
      if (hit && (q.status === "待报价" || q.status === "已报价")) {
        return { ...q, status: "已完成" as const, updatedAt: nowLocal() };
      }
      return q;
    });
    const changed = next.filter((q, i) => q.status !== prev[i]?.status);
    set({ quotes: next });
    if (changed.length) void upsertQuotes({ data: changed }).catch((err) => console.error(err));
  },
  setQuoteStatus: (id, status) => {
    const next = get().quotes.map((q) => (q.id === id ? { ...q, status, updatedAt: nowLocal() } : q));
    const row = next.find((q) => q.id === id);
    set({ quotes: next });
    if (row) void upsertQuote({ data: row }).catch((err) => console.error(err));
  },
  addPart: (input) => {
    const mpn = input.mpn.trim().toUpperCase();
    if (!mpn) return null;
    const existing = get().parts.find((p) => p.mpn === mpn);
    if (existing) return existing;
    const row: PooledPart = {
      id: uid(),
      mpn,
      brand: (input.brand || "").trim(),
      category: (input.category || "").trim(),
      notes: (input.notes || "").trim(),
      createdAt: nowLocal(),
    };
    set({ parts: [row, ...get().parts] });
    void upsertPart({ data: row }).catch((err) => console.error(err));
    return row;
  },
  removePart: (id) => {
    set({ parts: get().parts.filter((p) => p.id !== id) });
    void removePartRow({ data: { id } }).catch((err) => console.error(err));
  },
  addCustomer: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const hit = get().customers.find((c) => c.name === trimmed);
    if (hit) return hit;
    const row: CustomerRecord = { id: uid(), name: trimmed, createdAt: nowLocal() };
    set({ customers: [row, ...get().customers] });
    void upsertCustomer({ data: row }).catch((err) => console.error(err));
    return row;
  },
  removeCustomer: (id) => {
    set({ customers: get().customers.filter((c) => c.id !== id) });
    void removeCustomerRow({ data: { id } }).catch((err) => console.error(err));
  },
  backfill: (items) => {
    for (const item of items) {
      if (item.type === "报价" && item.status !== "已完成") get().captureFromItem(item);
    }
  },
  inquirersFor: (mpn) => {
    const key = mpn.trim().toUpperCase();
    return get().quotes.filter((q) => q.mpn === key);
  },
}));
