-- 0006_company_profiles.sql — 公司/供应商画像(方案 §16 六表补齐, 幂等)
create table if not exists company_profiles (
  id text primary key,
  name text not null,
  aliases jsonb not null default '[]'::jsonb,          -- 曾用名/简称
  main_brands jsonb not null default '[]'::jsonb,      -- 主营品牌
  top_mpns jsonb not null default '[]'::jsonb,         -- 高频型号 [{mpn, hits}]
  categories jsonb not null default '[]'::jsonb,
  stock_structure jsonb not null default '{}'::jsonb,  -- 库存结构摘要
  company_type text not null default 'unknown',        -- trade|agent|factory|unknown
  possible_customers text not null default '',
  evidence_ids jsonb not null default '[]'::jsonb,
  updated_at text not null
);
create unique index if not exists company_profiles_name_uidx on company_profiles (name);
