-- Human decision on a saved search report. Workbench owns the final business
-- decision; the Agent Platform never writes it. decision is nullable so old
-- reports (auto-saved) remain valid until a person reviews them.
alter table search_reports
  add column if not exists decision text,
  add column if not exists reviewed_at text,
  add column if not exists review_note text;

create index if not exists search_reports_reviewed_at_idx on search_reports (reviewed_at desc);