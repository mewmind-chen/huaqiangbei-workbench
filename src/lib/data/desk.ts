import { createServerFn } from "@tanstack/react-start";
import type { LookupRecord } from "@/lib/search/result-types";
import type { CustomerRecord, PooledPart, QuoteLine, TodoItem } from "@/lib/types";

export const loadDesk = createServerFn({ method: "GET" }).handler(async () => {
  const { loadDeskData } = await import("./desk.server");
  return loadDeskData();
});

export const upsertItem = createServerFn({ method: "POST" })
  .validator((input: TodoItem) => input)
  .handler(async ({ data }) => {
    const { upsertItemRow } = await import("./desk.server");
    await upsertItemRow(data);
    return { ok: true as const };
  });

export const upsertItems = createServerFn({ method: "POST" })
  .validator((input: TodoItem[]) => input)
  .handler(async ({ data }) => {
    const { upsertItemRow } = await import("./desk.server");
    for (const item of data) await upsertItemRow(item);
    return { ok: true as const };
  });

export const removeItem = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { deleteItemRow } = await import("./desk.server");
    await deleteItemRow(data.id);
    return { ok: true as const };
  });

export const upsertQuote = createServerFn({ method: "POST" })
  .validator((input: QuoteLine) => input)
  .handler(async ({ data }) => {
    const { upsertQuoteRow } = await import("./desk.server");
    await upsertQuoteRow(data);
    return { ok: true as const };
  });

export const upsertQuotes = createServerFn({ method: "POST" })
  .validator((input: QuoteLine[]) => input)
  .handler(async ({ data }) => {
    const { upsertQuoteRow } = await import("./desk.server");
    for (const row of data) await upsertQuoteRow(row);
    return { ok: true as const };
  });

export const upsertPart = createServerFn({ method: "POST" })
  .validator((input: PooledPart) => input)
  .handler(async ({ data }) => {
    const { upsertPartRow } = await import("./desk.server");
    await upsertPartRow(data);
    return { ok: true as const };
  });

export const removePartRow = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { deletePartRow } = await import("./desk.server");
    await deletePartRow(data.id);
    return { ok: true as const };
  });

export const upsertCustomer = createServerFn({ method: "POST" })
  .validator((input: CustomerRecord) => input)
  .handler(async ({ data }) => {
    const { upsertCustomerRow } = await import("./desk.server");
    await upsertCustomerRow(data);
    return { ok: true as const };
  });

export const removeCustomerRow = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { deleteCustomerRow } = await import("./desk.server");
    await deleteCustomerRow(data.id);
    return { ok: true as const };
  });

export const upsertReport = createServerFn({ method: "POST" })
  .validator((input: LookupRecord) => input)
  .handler(async ({ data }) => {
    const { upsertReportRow } = await import("./desk.server");
    await upsertReportRow(data);
    return { ok: true as const };
  });

export const removeReportRow = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { deleteReportRow } = await import("./desk.server");
    await deleteReportRow(data.id);
    return { ok: true as const };
  });

export const getReport = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { getReportRow } = await import("./desk.server");
    return getReportRow(data.id);
  });
