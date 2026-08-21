import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ClipboardPaste,
  List,
  Plus,
  Trash2,
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
  dayKeyFromDue,
  defaultDue,
  formatDayKey,
  formatShort,
  isOverdue,
} from "@/lib/dates";
import { blobToJpegBase64 } from "@/lib/image";
import { recognizeChatShot } from "@/lib/recognize";
import { emptyDraft, useTodoStore } from "@/lib/todo-store";
import { detectQuery } from "@/lib/search/md-parse";
import { ITEM_TYPES, type ItemStatus, type ItemType, type RecognizeDraft, type TodoItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkbenchStore } from "@/lib/workbench-store";

const FILTERS: { id: "all" | "overdue" | ItemStatus; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "overdue", label: "已超时" },
  { id: "待处理", label: "待处理" },
  { id: "处理中", label: "处理中" },
  { id: "已完成", label: "已完成" },
];

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
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<RecognizeDraft[]>([]);
  const [shipFrom, setShipFrom] = useState<TodoItem | null>(null);
  const [shipDue, setShipDue] = useState("");
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [dayFocus, setDayFocus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const open = items.filter((it) => it.status !== "已完成");
    const todayKey = formatDayKey(new Date());
    return {
      overdue: items.filter((it) => isOverdue(it)).length,
      pending: items.filter((it) => it.status === "待处理").length,
      doing: items.filter((it) => it.status === "处理中").length,
      doneToday: items.filter(
        (it) => it.status === "已完成" && it.doneAt && dayKeyFromDue(it.doneAt) === todayKey,
      ).length,
      doneAll: items.filter((it) => it.status === "已完成").length,
      amount: open.reduce((sum, it) => sum + (it.amount || 0), 0),
    };
  }, [items]);

  const visible = useMemo(() => {
    let list = items;
    if (filter === "overdue") list = items.filter((it) => isOverdue(it));
    else if (filter !== "all") list = items.filter((it) => it.status === filter);
    if (dayFocus) list = list.filter((it) => dayKeyFromDue(it.dueAt) === dayFocus);
    const rank = { 待处理: 0, 处理中: 1, 已完成: 2 };
    return [...list].sort((a, b) => {
      const rs = rank[a.status] - rank[b.status];
      if (rs !== 0) return rs;
      return a.dueAt.localeCompare(b.dueAt);
    });
  }, [items, filter, dayFocus]);

  async function runRecognize(blob: Blob) {
    setBusy(true);
    try {
      const url = URL.createObjectURL(blob);
      setPreview(url);
      const image = await blobToJpegBase64(blob);
      const result = await recognizeChatShot({ data: { image, mime: "image/jpeg" } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRecognized(result.items);
      toast.success(`识别到 ${result.items.length} 条事项，请确认后保存`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "识别失败");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
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
    });
    setDraft(emptyDraft());
    toast.success("已记入待处理");
  }

  function saveRecognized() {
    const rows = recognized.filter((it) => it.customer || it.content);
    if (!rows.length) return;
    for (const it of rows) {
      addItem({
        customer: it.customer || "客户",
        type: it.type,
        content: it.content,
        amount: it.amount,
        dueAt: it.dueAt,
      });
    }
    setRecognized([]);
    setPreview(null);
    toast.success(`已保存 ${rows.length} 条`);
  }

  function advance(item: TodoItem) {
    if (item.status === "待处理") {
      setStatus(item.id, "处理中");
      return;
    }
    if (item.status === "处理中") {
      setStatus(item.id, "已完成");
      if (item.type === "下单") {
        setShipFrom(item);
        setShipDue(defaultDue());
      }
    }
  }

  function confirmShip() {
    if (!shipFrom) return;
    addItem({
      customer: shipFrom.customer,
      type: "发货",
      content: `跟进「${shipFrom.content || "下单"}」发货`,
      amount: shipFrom.amount,
      dueAt: shipDue || null,
    });
    setShipFrom(null);
    toast.success("已安排发货");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">记录事项</h2>
            <p className="mt-1 text-xs text-muted">微信截图直接粘贴，或手动填写</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <ClipboardPaste className="size-4" />
            截图
          </Button>
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
        </div>

        <div className="grid gap-3">
          <Field label="客户">
            <Input
              value={draft.customer}
              placeholder="公司或昵称"
              onChange={(e) => setDraft({ ...draft, customer: e.target.value })}
            />
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
            <Field label="金额">
              <Input
                inputMode="decimal"
                placeholder="选填"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </Field>
          </div>
          <Field label="内容">
            <Textarea
              rows={3}
              placeholder="报价型号、数量、交期…"
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </Field>
          <Field label="提醒时间">
            <Input
              type="datetime-local"
              value={draft.dueAt}
              onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-faint">不填则默认今天 19:00，过点排到明天</p>
          </Field>
          <Button type="button" onClick={saveDraft}>
            <Plus className="size-4" />
            记录
          </Button>
        </div>
      </section>

      <section className="min-w-0">
        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat label="已超时" value={stats.overdue} tone="danger" />
          <Stat label="待处理" value={stats.pending} />
          <Stat label="处理中" value={stats.doing} />
          <Stat label="今日完成" value={stats.doneToday} />
          <Stat label="总完成" value={stats.doneAll} />
          <Stat label="未完结金额" value={stats.amount} money />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFilter(f.id);
                setDayFocus(null);
              }}
              className={cn(
                "h-9 rounded-full border px-3 text-xs font-medium",
                filter === f.id && !dayFocus
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-line bg-surface text-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            <Button
              type="button"
              size="icon"
              variant={view === "list" ? "default" : "secondary"}
              aria-label="列表"
              onClick={() => setView("list")}
            >
              <List className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={view === "calendar" ? "default" : "secondary"}
              aria-label="日历"
              onClick={() => setView("calendar")}
            >
              <CalendarDays className="size-4" />
            </Button>
          </div>
        </div>

        {dayFocus ? (
          <div className="mb-3 flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-xs">
            <span>只看 {dayFocus.slice(5).replace("-", "月")}日</span>
            <button type="button" className="text-accent" onClick={() => setDayFocus(null)}>
              清除
            </button>
          </div>
        ) : null}

        {view === "calendar" ? (
          <CalendarMonth
            month={calMonth}
            items={items}
            onPrev={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
            onNext={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
            onPick={(key) => {
              setDayFocus(key);
              setView("list");
            }}
          />
        ) : (
          <ul className="grid gap-3">
            {visible.length === 0 ? (
              <li className="rounded-xl border border-dashed border-line bg-surface px-5 py-12 text-center text-sm text-muted">
                这一栏还没有事项。粘贴客户截图，或在左侧记录一条。
              </li>
            ) : (
              visible.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-line bg-surface p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{item.customer}</h3>
                        <Badge variant="outline">{item.type}</Badge>
                        <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                        {isOverdue(item) ? <Badge variant="pending">已超时</Badge> : null}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-ink/90">
                        {item.content || "（无内容）"}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        {formatShort(item.dueAt)}
                        {item.carryCount > 0
                          ? ` · 已顺延 ${item.carryCount} 次${item.dueOrig ? `（原定 ${formatShort(item.dueOrig)}）` : ""}`
                          : ""}
                        {amountText(item.amount) ? ` · ${amountText(item.amount)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.type === "报价" && detectQuery(item.content).kind === "part" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const mpn = detectQuery(item.content).candidates[0];
                            if (mpn) openLookup(mpn, "part");
                          }}
                        >
                          查行情
                        </Button>
                      ) : null}
                      {item.status !== "已完成" ? (
                        <Button type="button" size="sm" onClick={() => advance(item)}>
                          {item.status === "待处理" ? "开始处理" : "已完成"}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="删除"
                        onClick={() => deleteItem(item.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      <Dialog open={!!preview} onOpenChange={(open) => !open && !busy && (setPreview(null), setRecognized([]))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{busy ? "正在识别截图" : "确认识别结果"}</DialogTitle>
            <DialogDescription>
              {busy ? "大约需要几秒，请稍候。" : "可改客户名后再保存。"}
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <img src={preview} alt="粘贴的聊天截图" className="mb-3 max-h-40 w-full rounded-md object-contain bg-bg" />
          ) : null}
          {busy ? (
            <p className="text-sm text-muted">识别中…</p>
          ) : (
            <div className="grid max-h-64 gap-3 overflow-y-auto">
              {recognized.map((it, i) => (
                <div key={i} className="rounded-md border border-line bg-surface p-3">
                  <Input
                    value={it.customer}
                    placeholder="客户"
                    onChange={(e) => {
                      const next = [...recognized];
                      next[i] = { ...it, customer: e.target.value };
                      setRecognized(next);
                    }}
                  />
                  <p className="mt-2 text-xs text-muted">
                    {it.type}
                    {it.amount != null ? ` · ¥${it.amount}` : ""}
                  </p>
                  <p className="mt-1 text-sm">{it.content}</p>
                </div>
              ))}
            </div>
          )}
          {!busy && recognized.length > 0 ? (
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => (setPreview(null), setRecognized([]))}>
                取消
              </Button>
              <Button type="button" onClick={saveRecognized}>
                保存
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!shipFrom} onOpenChange={(open) => !open && setShipFrom(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>安排发货</DialogTitle>
            <DialogDescription>
              {shipFrom ? `「${shipFrom.customer}」下单已完成，生成一条发货待办。` : ""}
            </DialogDescription>
          </DialogHeader>
          <Field label="发货提醒">
            <Input type="datetime-local" value={shipDue} onChange={(e) => setShipDue(e.target.value)} />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShipFrom(null)}>
              跳过
            </Button>
            <Button type="button" onClick={confirmShip}>
              生成发货
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
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

function Stat({
  label,
  value,
  tone,
  money,
}: {
  label: string;
  value: number;
  tone?: "danger";
  money?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={cn(
          "mt-1 font-medium tabular-nums",
          money ? "text-sm" : "text-lg",
          tone === "danger" && value > 0 ? "text-danger" : "text-ink",
        )}
      >
        {money ? `¥${value.toLocaleString("zh-CN")}` : value}
      </div>
    </div>
  );
}

function CalendarMonth({
  month,
  items,
  onPrev,
  onNext,
  onPick,
}: {
  month: Date;
  items: TodoItem[];
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
  const byDay = new Map<string, TodoItem[]>();
  for (const it of items) {
    const key = dayKeyFromDue(it.dueAt);
    const arr = byDay.get(key) || [];
    arr.push(it);
    byDay.set(key, arr);
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
          const list = byDay.get(key) || [];
          const pending = list.filter((it) => it.status === "待处理").length;
          const carried = list.filter((it) => it.carryCount > 0 && it.status !== "已完成").length;
          const done = list.filter((it) => it.status === "已完成").length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className="min-h-16 rounded-md border border-transparent p-1 text-left hover:border-line hover:bg-surface-2"
            >
              <div className="text-xs font-medium">{d.getDate()}</div>
              {list.length ? (
                <div className="mt-1 space-y-0.5 text-[10px] leading-tight text-muted">
                  {pending ? <div>待办 {pending}</div> : null}
                  {carried ? <div>顺延 {carried}</div> : null}
                  {done ? <div>完成 {done}</div> : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
