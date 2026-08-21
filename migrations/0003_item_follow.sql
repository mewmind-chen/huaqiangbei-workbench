alter table items add column if not exists priority text not null default '普通';
alter table items add column if not exists follow_up text not null default '';
