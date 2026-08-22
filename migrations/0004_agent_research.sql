-- 0004_agent_research.sql — Agent 研究层(schema-only, 幂等)
-- 方案B: DeepSeek Harness 集成。数据流: dsh 会话 -> MCP 工具 -> HTTP API -> 本库。
-- 惯例对齐既有表: text 主键(写入方生成), text ISO 时间戳, jsonb 载荷。

-- 每次 AI 研究任务一行: 输入、目标、状态机。
create table if not exists agent_tasks (
  id text primary key,
  type text not null default 'part_research',           -- part_research | company_research
  input jsonb not null,                                  -- { mpn/company, goal, holder_qty?, cost? }
  status text not null default 'running',                -- running | done | failed | cancelled
  error text not null default '',
  steps_done integer not null default 0,
  started_at text not null,
  finished_at text,
  runner text not null default 'dsh'                     -- 执行环境标识 (dsh / manual)
);

create index if not exists agent_tasks_started_idx on agent_tasks (started_at desc);

-- 过程日志: 每次 Tool 调用/决策/降级追加一条。
create table if not exists agent_events (
  id text primary key,
  task_id text not null,
  seq integer not null,
  ts text not null,
  phase text not null,                                   -- tool_call | observation | decision | error | degrade
  name text not null default '',                         -- tool 名, 如 market.hqew_search
  payload jsonb not null default '{}'::jsonb
);

create index if not exists agent_events_task_seq_idx on agent_events (task_id, seq);

-- 证据: 结论可追溯的最小单元。来源 + 抓取时间 + 结构化字段 + 可信级。
create table if not exists evidence_items (
  id text primary key,
  task_id text,
  mpn text not null default '',
  source_key text not null,                              -- lcsc | hqew | st | intel | internal
  url text not null default '',
  title text not null default '',
  captured_at text not null,
  trust text not null default 'medium',                  -- high(原厂/授权) | medium(垂直市场) | low(论坛线索)
  fields jsonb not null default '{}'::jsonb
);

create index if not exists evidence_items_task_idx on evidence_items (task_id);
create index if not exists evidence_items_mpn_idx on evidence_items (mpn, captured_at desc);

-- 市场快照: 同一型号不同时点的可比指标(热度/缺货/涨价判断的原始依据)。
create table if not exists market_snapshots (
  id text primary key,
  mpn text not null,
  captured_at text not null,
  task_id text,
  lcsc_stock integer,
  lcsc_min_price double precision,
  hqew_offer_count integer,
  hqew_supplier_count integer,
  hqew_yun_price double precision,                       -- 华强「云价格」参考价
  price_min double precision,
  price_max double precision,
  raw jsonb not null default '{}'::jsonb                 -- 完整 offers 原始数组, 防解析丢失
);

create index if not exists market_snapshots_mpn_time_idx on market_snapshots (mpn, captured_at desc);

-- 研究报告: 最终结论 + 置信度 + 引用的证据 id 列表(硬校验入口)。
create table if not exists research_reports (
  id text primary key,
  task_id text,
  query text not null,
  kind text not null default 'part',
  verdict jsonb not null default '{}'::jsonb,            -- { state, score, confidence, claims[] }
  report jsonb not null default '{}'::jsonb,             -- Skill 固化的章节结构
  evidence_ids jsonb not null default '[]'::jsonb,       -- 关联 evidence_items.id, 报告入库前校验存在
  created_at text not null
);

create index if not exists research_reports_created_idx on research_reports (created_at desc);
