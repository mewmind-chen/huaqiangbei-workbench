import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Camera,
  Check,
  Clock,
  List,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addHours,
  dayKeyFromDue,
  defaultDue,
  formatDayKey,
  formatShort,
  isDueToday,
  isOverdue,
  overdueLabel,
  todayOffWork,
  tomorrowOffWork,
} from "@/lib/dates";
import { blobToJpegBase64 } from "@/lib/image";
import { recognizeChatShot } from "@/lib/recognize";
import { emptyDraft, useTodoStore } from "@/lib/todo-store";
import { detectQuery } from "@/lib/search/md-parse";
import {
  ITEM_TYPES,
  PRIORITIES,
  STATUSES,
  type ItemPriority,
  type ItemStatus,
  type ItemType,
  type RecognizeDraft,
  type TodoItem,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkbenchStore } from "@/lib/workbench-store";

type DeskView = "today" | "all" | "calendar" | "customers";
type FocusGroup = "over" | "wait" | "today" | "doing" | "done" | null;

const PRIO_RANK: Record<ItemPriority, number> = { 紧急: 0, 重要: 1, 普通: 2 };

function prioOf(it: TodoItem): ItemPriority {
  return it.priority === "紧急" || it.priority === "重要" ? it.priority : "普通";
}

function prioSort(a: TodoItem, b: TodoItem) {
  const pr = PRIO_RANK[prioOf(a)] - PRIO_RANK[prioOf(b)];
  if (pr) return pr;
  return a.dueAt.localeCompare(b.dueAt);
}

function statusVariant(status: ItemStatus) {
  if (status === "待处理") return "pending" as const;
  if (status === "处理中") return "progress" as const;
  return "done" as const;
}

function amountText(amount: number | null) {
  if (amount == null) return null;
  return `¥${amount.toLocaleString("zh-CN")}`;
}

export function TodoPanel() {
  const items = useTodoStore((s) => s.items);
  const addItem = useTodoStore((s) => s.addItem);
  const updateItem = useTodoStore((s) => s.updateItem);
  const deleteItem = useTodoStore((s) => s.deleteItem);
  const setStatus = useTodoStore((s) => s.setStatus);
  const openLookup = useWorkbenchStore((s) => s.openLookup);

  const [draft, setDraft] = useState(emptyDraft);
  const [composer, setComposer] = useState<"recognize" | "manual">("recognize");
  const [view, setView] = useState<DeskView>("today");
  const [focusGroup, setFocusGroup] = useState<FocusGroup>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | ItemStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [searchText, setSearchText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<RecognizeDraft | null>(null);
  const [editPending, setEditPending] = useState(false);
  const [shipFrom, setShipFrom] = useState<TodoItem | null>(null);
  const [shipDue, setShipDue] = useState("");
  const [shipNote, setShipNote] = useState("");
  const [editItem, setEditItem] = useState<TodoItem | null>(null);
  const [followItem, setFollowItem] = useState<TodoItem | null>(null);
  const [followText, setFollowText] = useState("");
  const [rescheduleItem, setRescheduleItem] = useState<TodoItem | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [dayFocus, setDayFocus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pool = useMemo(() => {
    return items.filter((it) => {
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (typeFilter !== "all" && it.type !== typeFilter) return false;
      if (dayFocus) {
        const due = dayKeyFromDue(it.dueAt) === dayFocus;
        const done = it.doneAt && dayKeyFromDue(it.doneAt) === dayFocus;
        if (!due && !done) return false;
      }
      if (searchText.trim()) {
        const hay = `${it.customer} ${it.content} ${it.type} ${it.priority}`.toLowerCase();
        if (!hay.includes(searchText.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [items, statusFilter, typeFilter, searchText, dayFocus]);

  const todayKey = formatDayKey(new Date());
  const overAll = pool.filter((x) => isOverdue(x)).sort(prioSort);
  const waitAll = pool.filter((x) => x.status === "待处理").sort(prioSort);
  const todayAll = pool.filter((x) => isDueToday(x) && !isOverdue(x)).sort(prioSort);
  const doingAll = pool.filter((x) => x.status === "处理中").sort(prioSort);
  const doneTodayAll = pool
    .filter((x) => x.status === "已完成" && x.doneAt && dayKeyFromDue(x.doneAt) === todayKey)
    .sort(prioSort);
  const doneAll = pool.filter((x) => x.status === "已完成").sort(prioSort);

  const stats = {
    over: overAll.length,
    wait: waitAll.length,
    today: todayAll.length,
    doing: doingAll.length,
    done: doneTodayAll.length,
  };

  const recentCustomers = useMemo(() => {
    const seen: string[] = [];
    for (const it of items) {
      if (it.customer && !seen.includes(it.customer)) seen.push(it.customer);
    }
    return seen.slice(0, 8);
  }, [items]);

  const customerCards = useMemo(() => {
    const map = new Map<
      string,
      { customer: string; total: number; open: number; overdue: number; doing: number; amt: number }
    >();
    for (const it of items) {
      const row = map.get(it.customer) || {
        customer: it.customer,
        total: 0,
        open: 0,
        overdue: 0,
        doing: 0,
        amt: 0,
      };
      row.total += 1;
      if (it.status !== "已完成") {
        row.open += 1;
        row.amt += it.amount || 0;
      }
      if (isOverdue(it)) row.overdue += 1;
      if (it.status === "处理中") row.doing += 1;
      map.set(it.customer, row);
    }
    return [...map.values()].sort((a, b) => b.open - a.open || b.amt - a.amt);
  }, [items]);

  async function runRecognize(blob: Blob) {
    setBusy(true);
    setComposer("recognize");
    try {
      const image = await blobToJpegBase64(blob);
      const result = await recognizeChatShot({ data: { image, mime: "image/jpeg" } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const one = result.items[0];
      if (!one) {
        toast.error("没识别到事项，请手动填写");
        return;
      }
      setPending(one);
      setEditPending(false);
      toast.success("识别成功，请确认后保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "识别失败");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      if (typing && !file) return;
      e.preventDefault();
      setComposer("recognize");
      void runRecognize(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function saveDraft() {
    if (!draft.customer.trim()) {
      toast.error("客户不能为空");
      return;
    }
    addItem({
      customer: draft.customer,
      type: draft.type,
      content: draft.content,
      amount: draft.amount === "" ? null : Number(draft.amount),
      dueAt: draft.dueAt || null,
      priority: draft.priority,
    });
    setDraft(emptyDraft());
    toast.success("已记入待处理");
  }

  function savePending(row: RecognizeDraft) {
    if (!row.customer.trim()) {
      toast.error("请先改后存，补上客户名");
      setEditPending(true);
      return;
    }
    addItem({
      customer: row.customer,
      type: row.type,
      content: row.content,
      amount: row.amount,
      dueAt: row.dueAt,
      priority: row.priority || "普通",
    });
    setPending(null);
    setEditPending(false);
    toast.success("已保存");
  }

  function complete(item: TodoItem) {
    setStatus(item.id, "已完成");
    if (item.type === "下单") {
      setShipFrom(item);
      setShipDue(tomorrowOffWork());
      setShipNote("");
    }
  }

  function confirmShip() {
    if (!shipFrom) return;
    addItem({
      customer: shipFrom.customer,
      type: "发货",
      content: `【下单已完成】${shipFrom.content || "订单"}${shipNote.trim() ? `；${shipNote.trim()}` : ""}`,
      amount: shipFrom.amount,
      dueAt: shipDue || null,
      priority: shipFrom.priority,
    });
    setShipFrom(null);
    toast.success("已安排发货");
  }

  function clickStat(group: FocusGroup) {
    setFocusGroup((cur) => (cur === group ? null : group));
    setView("today");
    setDayFocus(null);
  }

  const FOCUS: Record<
    Exclude<FocusGroup, null>,
    { arr: TodoItem[]; label: string }
  > = {
    over: { arr: overAll, label: "已超时" },
    wait: { arr: waitAll, label: "待处理" },
    today: { arr: todayAll, label: "今天到期" },
    doing: { arr: doingAll, label: "处理中" },
    done: { arr: doneTodayAll, label: "今天已完成" },
  };

  function renderCards(list: TodoItem[]) {
    if (!list.length) {
      return (
        <div className="rounded-xl border border-dashed border-line bg-surface px-5 py-12 text-center text-sm text-muted">
          这一栏还没有事项。粘贴客户截图，或手动记录一条。
        </div>
      );
    }
    return (
      <ul className="grid gap-3">
        {list.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            onLookup={() => {
              const hit = detectQuery(item.content);
              if (hit.kind === "part" && hit.candidates[0]) openLookup(hit.candidates[0], "part");
            }}
            onStart={() => setStatus(item.id, "处理中")}
            onComplete={() => complete(item)}
            onReopen={() => setStatus(item.id, "处理中")}
            onFollow={() => {
              setFollowItem(item);
              setFollowText(item.followUp || "");
            }}
            onReschedule={() => {
              setRescheduleItem(item);
              setRescheduleAt(item.dueAt);
            }}
            onEdit={() => setEditItem({ ...item })}
            onDelete={() => {
              deleteItem(item.id);
              toast.success("已删除");
            }}
          />
        ))}
      </ul>
    );
  }

  function section(title: string, count: number, extra: ReactNode, tone?: string) {
    return (
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("size-2 rounded-full", tone || "bg-accent")} />
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted">{count} 条{extra}</span>
      </div>
    );
  }

  function todayBody() {
    if (focusGroup && FOCUS[focusGroup]) {
      const f = FOCUS[focusGroup];
      return (
        <div>
          {section(f.label, f.arr.length, null, focusGroup === "over" ? "bg-danger" : "bg-accent")}
          {renderCards(f.arr)}
        </div>
      );
    }
    const over = overAll;
    const today = todayAll;
    const doing = doingAll.filter((x) => !isOverdue(x) && !isDueToday(x));
    const done = doneAll;
    return (
      <div className="grid gap-6">
        {over.length ? (
          <div>
            {section("已超时", over.length, "，优先处理", "bg-danger")}
            {renderCards(over)}
          </div>
        ) : null}
        {today.length ? (
          <div>
            {section("今天到期", today.length, null, "bg-wait")}
            {renderCards(today)}
          </div>
        ) : null}
        {doing.length ? (
          <div>
            {section("处理中", doing.length, null, "bg-wait")}
            {renderCards(doing)}
          </div>
        ) : null}
        {done.length ? (
          <div>
            <button
              type="button"
              className="mb-2 flex w-full items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              onClick={() => setDoneOpen((v) => !v)}
            >
              <span>已完成</span>
              <span className="text-xs text-muted">{done.length} 条 · {doneOpen ? "收起" : "点击查看"}</span>
            </button>
            {doneOpen ? renderCards(done) : null}
          </div>
        ) : null}
        {!over.length && !today.length && !doing.length && !done.length
          ? renderCards([])
          : null}
      </div>
    );
  }

  function allBody() {
    if (statusFilter !== "all") {
      const arr = [...pool].sort(prioSort);
      return (
        <div>
          {section(statusFilter, arr.length, null)}
          {renderCards(arr)}
        </div>
      );
    }
    return (
      <div className="grid gap-6">
        {STATUSES.map((st) => {
          const group = pool.filter((x) => x.status === st).sort(prioSort);
          if (!group.length) return null;
          return (
            <div key={st}>
              {section(st, group.length, st === "待处理" ? "，先处理这些" : null)}
              {renderCards(group)}
            </div>
          );
        })}
        {!pool.length ? renderCards([]) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ["over", "当前超时", stats.over, true],
            ["wait", "待处理", stats.wait, false],
            ["today", "今天到期", stats.today, false],
            ["doing", "处理中", stats.doing, false],
            ["done", "今天已完成", stats.done, false],
          ] as const
        ).map(([id, label, value, warn]) => (
          <button
            key={id}
            type="button"
            onClick={() => clickStat(id)}
            className={cn(
              "rounded-lg border bg-surface px-3 py-2 text-left",
              focusGroup === id ? "border-accent" : "border-line",
            )}
          >
            <div className="text-[11px] text-muted">{label}</div>
            <div className={cn("mt-1 text-lg font-medium tabular-nums", warn && value > 0 ? "text-danger" : "text-ink")}>
              {value}
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["today", "今天"],
            ["all", "全部事项"],
            ["calendar", "日历"],
            ["customers", "客户"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setView(id);
              if (id !== "today") setFocusGroup(null);
            }}
            className={cn(
              "h-9 rounded-full border px-3 text-xs font-medium",
              view === id ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {id === "today" ? <List className="mr-1 inline size-3.5" /> : null}
            {id === "calendar" ? <CalendarDays className="mr-1 inline size-3.5" /> : null}
            {id === "customers" ? <Users className="mr-1 inline size-3.5" /> : null}
            {label}
          </button>
        ))}
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            className="pl-9"
            placeholder="搜索客户 / 内容 / 型号"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setFocusGroup(null);
            }}
          />
        </div>
      </div>

      {view === "calendar" ? (
        <CalendarMonth
          month={calMonth}
          items={items}
          selected={dayFocus}
          onPrev={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
          onNext={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
          onPick={(key) => {
            setDayFocus(dayFocus === key ? null : key);
            setView("today");
            setFocusGroup(null);
          }}
        />
      ) : view === "customers" ? (
        <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
          <h2 className="text-base font-semibold">客户概览</h2>
          {!customerCards.length ? (
            <p className="mt-6 text-sm text-muted">还没有客户事项。</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {customerCards.map((c) => (
                <button
                  key={c.customer}
                  type="button"
                  className="rounded-lg border border-line bg-surface-2 p-3 text-left"
                  onClick={() => {
                    setSearchText(c.customer);
                    setView("all");
                  }}
                >
                  <h3 className="text-sm font-semibold">{c.customer}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {c.open} 项待处理 · {c.doing} 项处理中
                  </p>
                  <p className="mt-1 text-xs">
                    未完结金额 <span className="font-medium">{amountText(c.amt) || "—"}</span>
                  </p>
                  <p className={cn("mt-1 text-xs", c.overdue ? "text-danger" : "text-muted")}>
                    {c.overdue ? `${c.overdue} 项已超时` : "无超时"} · 共 {c.total} 条
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <aside className="grid h-fit gap-4">
            <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
              <div className="mb-4 flex gap-1 rounded-lg border border-line bg-surface-2 p-1">
                <button
                  type="button"
                  className={cn(
                    "h-8 flex-1 rounded-md text-xs font-medium",
                    composer === "recognize" ? "bg-surface text-ink shadow-sm" : "text-muted",
                  )}
                  onClick={() => setComposer("recognize")}
                >
                  截图识别
                </button>
                <button
                  type="button"
                  className={cn(
                    "h-8 flex-1 rounded-md text-xs font-medium",
                    composer === "manual" ? "bg-surface text-ink shadow-sm" : "text-muted",
                  )}
                  onClick={() => setComposer("manual")}
                >
                  手动录入
                </button>
              </div>

              {composer === "recognize" ? (
                <button
                  type="button"
                  className="grid w-full gap-2 rounded-lg border border-dashed border-line bg-surface-2 px-4 py-8 text-center"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  <Camera className="mx-auto size-6 text-muted" />
                  <p className="text-sm">截图后按 Ctrl+V 粘贴识别</p>
                  <p className="text-xs text-muted">自动提取客户、类型、内容、金额，或点这里选图</p>
                  {busy ? <p className="text-xs text-accent">识别中…</p> : null}
                  {pending ? <p className="text-xs text-ok">已识别，请在右侧确认</p> : null}
                </button>
              ) : (
                <div className="grid gap-3">
                  <Field label="客户">
                    <Input
                      value={draft.customer}
                      placeholder="客户名称"
                      list="todo-customer-list"
                      onChange={(e) => setDraft({ ...draft, customer: e.target.value })}
                    />
                    <datalist id="todo-customer-list">
                      {recentCustomers.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="类型">
                      <select
                        className="h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-sm"
                        value={draft.type}
                        onChange={(e) => setDraft({ ...draft, type: e.target.value as ItemType })}
                      >
                        {ITEM_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="优先级">
                      <select
                        className="h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-sm"
                        value={draft.priority}
                        onChange={(e) => setDraft({ ...draft, priority: e.target.value as ItemPriority })}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="内容（客户说了啥）">
                    <Textarea
                      rows={3}
                      placeholder="如：0603 10K 电阻 200K 报价"
                      value={draft.content}
                      onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="金额">
                      <Input
                        inputMode="decimal"
                        placeholder="选填"
                        value={draft.amount}
                        onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                      />
                    </Field>
                    <Field label="需处理时间">
                      <Input
                        type="datetime-local"
                        value={draft.dueAt}
                        onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })}
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] text-faint">不填时间 = 默认今天 19:00（下班前）</p>
                  <Button type="button" onClick={saveDraft}>
                    <Plus className="size-4" />
                    记录（自动进待处理）
                  </Button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void runRecognize(file);
                }}
              />
            </section>

            <section className="rounded-xl border border-line bg-surface p-4">
              <h3 className="text-sm font-semibold">最近客户</h3>
              {!recentCustomers.length ? (
                <p className="mt-2 text-xs text-muted">暂无客户</p>
              ) : (
                <ul className="mt-2 grid gap-1">
                  {recentCustomers.slice(0, 5).map((name) => {
                    const its = items.filter((x) => x.customer === name);
                    const open = its.filter((x) => x.status !== "已完成").length;
                    const overdue = its.filter((x) => isOverdue(x)).length;
                    return (
                      <li key={name}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                          onClick={() => {
                            setSearchText(name);
                            setView("all");
                          }}
                        >
                          <span>{name}</span>
                          <span className="text-xs text-muted">
                            {open} 项待处理
                            {overdue ? <span className="text-danger"> · {overdue} 超时</span> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>

          <section className="min-w-0">
            {pending ? (
              <div className="mb-4 rounded-xl border border-accent/40 bg-surface p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{pending.customer || "（未识别客户）"}</h3>
                  <Badge variant="outline">{pending.type}</Badge>
                  {pending.amount != null ? <span className="text-xs font-medium">{amountText(pending.amount)}</span> : null}
                  <Badge variant="progress">待确认</Badge>
                </div>
                <p className="text-sm leading-relaxed">{pending.content || "（无内容）"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => savePending(pending)}>
                    保存
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditPending(true)}>
                    改后存
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPending(null);
                      setEditPending(false);
                    }}
                  >
                    丢弃
                  </Button>
                </div>
              </div>
            ) : null}
            {dayFocus ? (
              <div className="mb-3 flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-xs">
                <span>只看 {dayFocus.slice(5).replace("-", "月")}日</span>
                <button type="button" className="text-accent" onClick={() => setDayFocus(null)}>
                  清除
                </button>
              </div>
            ) : null}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-sm font-semibold">{view === "today" ? "今天要处理" : "全部事项"}</h2>
              {(["all", "待处理", "处理中", "已完成"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatusFilter(s);
                    setFocusGroup(null);
                  }}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs",
                    statusFilter === s ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted",
                  )}
                >
                  {s === "all" ? "全部" : s}
                </button>
              ))}
              <select
                className="h-8 rounded-full border border-line bg-surface px-3 text-xs"
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value as "all" | ItemType);
                  setFocusGroup(null);
                }}
              >
                <option value="all">全部类型</option>
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {view === "today" ? todayBody() : allBody()}
          </section>
        </div>
      )}

      <Dialog open={editPending && !!pending} onOpenChange={(open) => !open && setEditPending(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认并保存识别结果</DialogTitle>
            <DialogDescription>不填时间 = 默认今天 19:00，到点提醒。</DialogDescription>
          </DialogHeader>
          {pending ? (
            <div className="grid gap-3">
              <Field label="客户">
                <Input
                  value={pending.customer}
                  placeholder="客户名称"
                  onChange={(e) => setPending({ ...pending, customer: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="类型">
                  <select
                    className="h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-sm"
                    value={pending.type}
                    onChange={(e) => setPending({ ...pending, type: e.target.value as ItemType })}
                  >
                    {ITEM_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="优先级">
                  <select
                    className="h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-sm"
                    value={pending.priority || "普通"}
                    onChange={(e) => setPending({ ...pending, priority: e.target.value as ItemPriority })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="内容">
                <Input
                  value={pending.content}
                  onChange={(e) => setPending({ ...pending, content: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="金额">
                  <Input
                    inputMode="decimal"
                    value={pending.amount ?? ""}
                    onChange={(e) =>
                      setPending({
                        ...pending,
                        amount: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="处理时间">
                  <Input
                    type="datetime-local"
                    value={pending.dueAt || ""}
                    onChange={(e) => setPending({ ...pending, dueAt: e.target.value || null })}
                  />
                </Field>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditPending(false)}>
                  取消
                </Button>
                <Button type="button" onClick={() => savePending(pending)}>
                  保存
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!shipFrom} onOpenChange={(open) => !open && setShipFrom(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>安排发货</DialogTitle>
            <DialogDescription>
              {shipFrom ? `下单已完成，为「${shipFrom.customer}」生成发货待办。` : ""}
            </DialogDescription>
          </DialogHeader>
          <Field label="发货时间">
            <Input type="datetime-local" value={shipDue} onChange={(e) => setShipDue(e.target.value)} />
          </Field>
          <Field label="备注">
            <Input value={shipNote} placeholder="如：顺丰 / 包邮" onChange={(e) => setShipNote(e.target.value)} />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShipFrom(null)}>
              跳过
            </Button>
            <Button type="button" onClick={confirmShip}>
              创建发货任务
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!followItem} onOpenChange={(open) => !open && setFollowItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加跟进</DialogTitle>
            <DialogDescription>
              {followItem ? `「${followItem.customer} · ${followItem.type}」最近进展` : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            maxLength={300}
            placeholder="如：已报价，等客户回复"
            value={followText}
            onChange={(e) => setFollowText(e.target.value)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFollowItem(null)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (followItem) updateItem(followItem.id, { followUp: followText.trim() });
                setFollowItem(null);
                toast.success("已记下跟进");
              }}
            >
              保存跟进
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rescheduleItem} onOpenChange={(open) => !open && setRescheduleItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>改期</DialogTitle>
            <DialogDescription>
              {rescheduleItem ? `「${rescheduleItem.customer} · ${rescheduleItem.type}」改到什么时候？` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setRescheduleAt(addHours(1))}>
              1 小时后
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setRescheduleAt(todayOffWork())}>
              今天下班前
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setRescheduleAt(tomorrowOffWork())}>
              明天 19:00
            </Button>
          </div>
          <Field label="自定义时间">
            <Input type="datetime-local" value={rescheduleAt} onChange={(e) => setRescheduleAt(e.target.value)} />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRescheduleItem(null)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!rescheduleAt) {
                  toast.error("请选择时间");
                  return;
                }
                if (rescheduleItem) updateItem(rescheduleItem.id, { dueAt: rescheduleAt, dueDefault: false });
                setRescheduleItem(null);
                toast.success("已改期");
              }}
            >
              确认改期
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑事项</DialogTitle>
          </DialogHeader>
          {editItem ? (
            <div className="grid gap-3">
              <Field label="客户">
                <Input
                  value={editItem.customer}
                  onChange={(e) => setEditItem({ ...editItem, customer: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="类型">
                  <select
                    className="h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-sm"
                    value={editItem.type}
                    onChange={(e) => setEditItem({ ...editItem, type: e.target.value as ItemType })}
                  >
                    {ITEM_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="优先级">
                  <select
                    className="h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-sm"
                    value={prioOf(editItem)}
                    onChange={(e) => setEditItem({ ...editItem, priority: e.target.value as ItemPriority })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="内容">
                <Textarea
                  rows={3}
                  value={editItem.content}
                  onChange={(e) => setEditItem({ ...editItem, content: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="金额">
                  <Input
                    inputMode="decimal"
                    value={editItem.amount ?? ""}
                    onChange={(e) =>
                      setEditItem({
                        ...editItem,
                        amount: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="时间">
                  <Input
                    type="datetime-local"
                    value={editItem.dueAt}
                    onChange={(e) => setEditItem({ ...editItem, dueAt: e.target.value, dueDefault: false })}
                  />
                </Field>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditItem(null)}>
                  取消
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    updateItem(editItem.id, {
                      customer: editItem.customer,
                      type: editItem.type,
                      content: editItem.content,
                      amount: editItem.amount,
                      dueAt: editItem.dueAt,
                      dueDefault: editItem.dueDefault,
                      priority: prioOf(editItem),
                    });
                    setEditItem(null);
                    toast.success("已保存");
                  }}
                >
                  保存
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemCard({
  item,
  onLookup,
  onStart,
  onComplete,
  onReopen,
  onFollow,
  onReschedule,
  onEdit,
  onDelete,
}: {
  item: TodoItem;
  onLookup: () => void;
  onStart: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onFollow: () => void;
  onReschedule: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const prio = prioOf(item);
  const overdue = isOverdue(item);
  const canLookup = item.type === "报价" && detectQuery(item.content).kind === "part";
  return (
    <li
      className={cn(
        "rounded-xl border bg-surface p-4",
        overdue ? "border-danger/40" : "border-line",
        prio === "紧急" ? "ring-1 ring-danger/20" : "",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{item.customer}</h3>
            <Badge variant="outline">{item.type}</Badge>
            {item.amount != null ? <span className="text-xs font-medium">{amountText(item.amount)}</span> : null}
            {prio !== "普通" ? <Badge variant={prio === "紧急" ? "urgent" : "important"}>{prio}</Badge> : null}
            <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
            {overdue ? <Badge variant="pending">已超时 {overdueLabel(item.dueAt)}</Badge> : null}
            {item.carryCount > 0 ? <Badge variant="outline">顺延 {item.carryCount}</Badge> : null}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink/90">{item.content || "（无内容）"}</p>
          <p className="mt-2 text-xs text-muted">
            {item.dueDefault ? `今天下班前（默认 ${item.dueAt.slice(11, 16)}）` : `应处理 ${formatShort(item.dueAt)}`}
            {item.doneAt ? ` · 完成于 ${formatShort(item.doneAt)}` : ""}
          </p>
          {item.followUp ? (
            <p className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-xs">
              <span className="text-muted">最近跟进：</span>
              {item.followUp}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {canLookup ? (
          <Button type="button" size="sm" variant="secondary" onClick={onLookup}>
            查行情
          </Button>
        ) : null}
        {item.status === "待处理" ? (
          <Button type="button" size="sm" onClick={onStart}>
            <Play className="size-3.5" />
            开始处理
          </Button>
        ) : null}
        {item.status === "处理中" ? (
          <Button type="button" size="sm" onClick={onComplete}>
            <Check className="size-3.5" />
            已完成
          </Button>
        ) : null}
        {item.status === "已完成" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onReopen}>
            <RotateCcw className="size-3.5" />
            重新打开
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={onFollow}>
          <StickyNote className="size-3.5" />
          跟进
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onReschedule}>
          <Clock className="size-3.5" />
          改期
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="编辑" onClick={onEdit}>
          <Pencil className="size-4" />
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="删除" onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function CalendarMonth({
  month,
  items,
  selected,
  onPrev,
  onNext,
  onPick,
}: {
  month: Date;
  items: TodoItem[];
  selected: string | null;
  onPrev: () => void;
  onNext: () => void;
  onPick: (key: string) => void;
}) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1);
  const startPad = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = Array.from({ length: startPad + days }, (_, i) => {
    if (i < startPad) return null;
    return new Date(y, m, i - startPad + 1);
  });
  const today = formatDayKey(new Date());
  const byDay = new Map<string, { todo: number; carry: number; done: number }>();
  for (const it of items) {
    if (it.status === "已完成") {
      if (!it.doneAt) continue;
      const key = dayKeyFromDue(it.doneAt);
      const row = byDay.get(key) || { todo: 0, carry: 0, done: 0 };
      row.done += 1;
      byDay.set(key, row);
      continue;
    }
    const key = dayKeyFromDue(it.dueAt);
    const row = byDay.get(key) || { todo: 0, carry: 0, done: 0 };
    row.todo += 1;
    if (it.carryCount > 0) row.carry += 1;
    byDay.set(key, row);
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" className="text-sm text-muted" onClick={onPrev}>
          上个月
        </button>
        <h3 className="text-sm font-semibold">
          {y}年{m + 1}月
        </h3>
        <button type="button" className="text-sm text-muted" onClick={onNext}>
          下个月
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-faint">
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e-${i}`} />;
          const key = formatDayKey(d);
          const info = byDay.get(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={cn(
                "min-h-16 rounded-md border p-1 text-left",
                key === today ? "border-accent" : "border-transparent",
                key === selected ? "bg-surface-2" : "hover:border-line hover:bg-surface-2",
              )}
            >
              <div className="text-xs font-medium">{d.getDate()}</div>
              {info ? (
                <div className="mt-1 space-y-0.5 text-[10px] leading-tight text-muted">
                  {info.todo ? <div>待办 {info.todo}</div> : null}
                  {info.carry ? <div>顺延 {info.carry}</div> : null}
                  {info.done ? <div>完成 {info.done}</div> : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
