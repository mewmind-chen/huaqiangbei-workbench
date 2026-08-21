const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowLocal(): string {
  return toLocalInput(new Date());
}

export function defaultDue(now = new Date()): string {
  const d = new Date(now);
  d.setHours(19, 0, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return toLocalInput(d);
}

export function parseLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(value || "").trim(),
  );
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || 0),
  );
}

export function formatShort(value: string): string {
  const d = parseLocal(value);
  if (!d) return value;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayKeyFromDue(value: string): string {
  return value.slice(0, 10);
}

export function isOverdue(item: { status: string; dueAt: string }, now = new Date()): boolean {
  if (item.status === "已完成") return false;
  const d = parseLocal(item.dueAt);
  return !!d && d.getTime() <= now.getTime();
}

export function isPastDay(value: string, now = new Date()): boolean {
  const d = parseLocal(value);
  if (!d) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return dueDay < today;
}

export function addDaysKeepTime(value: string, days: number): string {
  const d = parseLocal(value);
  if (!d) return value;
  d.setDate(d.getDate() + days);
  return toLocalInput(d);
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function formatHeaderClock(now = new Date()): string {
  return `${now.getMonth() + 1}月${now.getDate()}日 周${WEEKDAYS[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
