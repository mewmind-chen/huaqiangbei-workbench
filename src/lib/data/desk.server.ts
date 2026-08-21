import { getSql } from "@/lib/db";
import { detectQuery } from "@/lib/search/md-parse";
import { reportSummary } from "@/lib/search/analyze";
import type { LookupRecord } from "@/lib/search/result-types";
import { seedItems } from "@/lib/seed";
import { nowLocal } from "@/lib/dates";
import type {
  CustomerRecord,
  PooledPart,
  QuoteLine,
  ReportSummary,
  TodoItem,
} from "@/lib/types";

type ItemRow = {
  id: string;
  customer: string;
  type: string;
  content: string;
  amount: number | null;
  status: string;
  due_at: string;
  due_default: boolean;
  created_at: string;
  done_at: string | null;
  carry_count: number;
  due_orig: string | null;
};

type QuoteRow = {
  id: string;
  customer: string;
  mpn: string;
  item_id: string | null;
  status: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type PartRow = {
  id: string;
  mpn: string;
  brand: string;
  category: string;
  notes: string;
  created_at: string;
};

type CustomerRow = {
  id: string;
  name: string;
  created_at: string;
};

type ReportRow = {
  id: string;
  query: string;
  kind: string;
  created_at: string;
  summary: string;
  payload?: unknown;
};

function mapItem(r: ItemRow): TodoItem {
  return {
    id: r.id,
    customer: r.customer,
    type: r.type as TodoItem["type"],
    content: r.content,
    amount: r.amount == null ? null : Number(r.amount),
    status: r.status as TodoItem["status"],
    dueAt: r.due_at,
    dueDefault: Boolean(r.due_default),
    createdAt: r.created_at,
    doneAt: r.done_at,
    carryCount: Number(r.carry_count || 0),
    dueOrig: r.due_orig,
  };
}

function mapQuote(r: QuoteRow): QuoteLine {
  return {
    id: r.id,
    customer: r.customer,
    mpn: r.mpn,
    itemId: r.item_id,
    status: r.status as QuoteLine["status"],
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPart(r: PartRow): PooledPart {
  return {
    id: r.id,
    mpn: r.mpn,
    brand: r.brand,
    category: r.category,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

function mapCustomer(r: CustomerRow): CustomerRecord {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}

function mapSummary(r: ReportRow): ReportSummary {
  return {
    id: r.id,
    query: r.query,
    kind: r.kind as ReportSummary["kind"],
    createdAt: r.created_at,
    summary: r.summary,
  };
}

export async function upsertItemRow(item: TodoItem) {
  const sql = await getSql();
  await sql.query(
    `insert into items (
      id, customer, type, content, amount, status, due_at, due_default,
      created_at, done_at, carry_count, due_orig
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    on conflict (id) do update set
      customer = excluded.customer,
      type = excluded.type,
      content = excluded.content,
      amount = excluded.amount,
      status = excluded.status,
      due_at = excluded.due_at,
      due_default = excluded.due_default,
      done_at = excluded.done_at,
      carry_count = excluded.carry_count,
      due_orig = excluded.due_orig`,
    [
      item.id,
      item.customer,
      item.type,
      item.content,
      item.amount,
      item.status,
      item.dueAt,
      item.dueDefault,
      item.createdAt,
      item.doneAt,
      item.carryCount,
      item.dueOrig,
    ],
  );
}

export async function deleteItemRow(id: string) {
  const sql = await getSql();
  await sql.query("delete from items where id = $1", [id]);
}

export async function upsertQuoteRow(row: QuoteLine) {
  const sql = await getSql();
  await sql.query(
    `insert into quote_lines (
      id, customer, mpn, item_id, status, content, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (id) do update set
      customer = excluded.customer,
      mpn = excluded.mpn,
      item_id = excluded.item_id,
      status = excluded.status,
      content = excluded.content,
      updated_at = excluded.updated_at`,
    [row.id, row.customer, row.mpn, row.itemId, row.status, row.content, row.createdAt, row.updatedAt],
  );
}

export async function upsertPartRow(row: PooledPart) {
  const sql = await getSql();
  await sql.query(
    `insert into parts (id, mpn, brand, category, notes, created_at)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set
       mpn = excluded.mpn,
       brand = excluded.brand,
       category = excluded.category,
       notes = excluded.notes`,
    [row.id, row.mpn, row.brand, row.category, row.notes, row.createdAt],
  );
}

export async function deletePartRow(id: string) {
  const sql = await getSql();
  await sql.query("delete from parts where id = $1", [id]);
}

export async function upsertCustomerRow(row: CustomerRecord) {
  const sql = await getSql();
  await sql.query(
    `insert into customers (id, name, created_at) values ($1,$2,$3)
     on conflict (id) do update set name = excluded.name`,
    [row.id, row.name, row.createdAt],
  );
}

export async function deleteCustomerRow(id: string) {
  const sql = await getSql();
  await sql.query("delete from customers where id = $1", [id]);
}

export async function upsertReportRow(record: LookupRecord) {
  const sql = await getSql();
  const summary = reportSummary(record.kind, record.identity, record.offers);
  await sql.query(
    `insert into search_reports (id, query, kind, created_at, summary, payload)
     values ($1,$2,$3,$4,$5,$6::jsonb)
     on conflict (id) do update set
       query = excluded.query,
       kind = excluded.kind,
       summary = excluded.summary,
       payload = excluded.payload`,
    [record.id, record.query, record.kind, record.createdAt, summary, JSON.stringify(record)],
  );
}

export async function deleteReportRow(id: string) {
  const sql = await getSql();
  await sql.query("delete from search_reports where id = $1", [id]);
}

export async function getReportRow(id: string): Promise<LookupRecord | null> {
  const sql = await getSql();
  const rows = await sql.query<ReportRow>("select payload from search_reports where id = $1", [id]);
  const raw = rows[0]?.payload;
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as LookupRecord) : (raw as LookupRecord);
}

async function seedQuotesFromItems(items: TodoItem[]) {
  for (const item of items) {
    if (item.type !== "报价" || item.status === "已完成") continue;
    const found = detectQuery(item.content);
    const mpns = found.kind === "part" ? found.candidates : [];
    await upsertCustomerRow({
      id: `cust-${item.customer}`,
      name: item.customer,
      createdAt: item.createdAt,
    });
    for (const mpn of mpns) {
      await upsertQuoteRow({
        id: `quote-${item.id}-${mpn}`,
        customer: item.customer,
        mpn,
        itemId: item.id,
        status: "待报价",
        content: item.content.slice(0, 500),
        createdAt: nowLocal(),
        updatedAt: nowLocal(),
      });
    }
  }
}

export async function loadDeskData() {
  const sql = await getSql();
  let items = (await sql.query<ItemRow>("select * from items order by created_at desc")).map(mapItem);
  if (!items.length) {
    items = seedItems();
    for (const item of items) await upsertItemRow(item);
    await seedQuotesFromItems(items);
  }
  const quotes = (await sql.query<QuoteRow>("select * from quote_lines order by updated_at desc")).map(mapQuote);
  const parts = (await sql.query<PartRow>("select * from parts order by created_at desc")).map(mapPart);
  const customers = (await sql.query<CustomerRow>("select * from customers order by created_at desc")).map(
    mapCustomer,
  );
  const reports = (
    await sql.query<ReportRow>(
      "select id, query, kind, created_at, summary from search_reports order by created_at desc limit 50",
    )
  ).map(mapSummary);
  return { items, quotes, parts, customers, reports };
}
