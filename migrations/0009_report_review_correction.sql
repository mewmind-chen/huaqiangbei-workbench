-- Persist the reviewer's corrected report payload. Workbench owns the
-- correction; the Agent Platform never writes it. 0008 only stored a note.
alter table search_reports
  add column if not exists corrected_json text;
