-- 0005_agent_research_constraints.sql — 对抗审查 E 修复:
-- agent_events (task_id, seq) 唯一化, 让并发取号冲突显式失败而非静默乱序。
create unique index if not exists agent_events_task_seq_uidx on agent_events (task_id, seq);
