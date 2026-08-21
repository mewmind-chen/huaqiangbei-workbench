create table if not exists items (
  id text primary key,
  customer text not null,
  type text not null,
  content text not null default '',
  amount double precision,
  status text not null,
  due_at text not null,
  due_default boolean not null default false,
  created_at text not null,
  done_at text,
  carry_count integer not null default 0,
  due_orig text
);

create table if not exists quote_lines (
  id text primary key,
  customer text not null,
  mpn text not null,
  item_id text,
  status text not null,
  content text not null default '',
  created_at text not null,
  updated_at text not null
);

create table if not exists parts (
  id text primary key,
  mpn text not null,
  brand text not null default '',
  category text not null default '',
  notes text not null default '',
  created_at text not null
);

create unique index if not exists parts_mpn_idx on parts (mpn);

create table if not exists customers (
  id text primary key,
  name text not null,
  created_at text not null
);

create unique index if not exists customers_name_idx on customers (name);

create table if not exists search_reports (
  id text primary key,
  query text not null,
  kind text not null,
  created_at text not null,
  summary text not null default '',
  payload jsonb not null
);

create index if not exists search_reports_created_at_idx on search_reports (created_at desc);
create index if not exists quote_lines_status_idx on quote_lines (status);
create index if not exists items_status_idx on items (status);
