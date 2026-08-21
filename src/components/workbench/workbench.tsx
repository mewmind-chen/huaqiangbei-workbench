import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SearchPanel } from "@/components/workbench/search-panel";
import { TodoPanel } from "@/components/workbench/todo-panel";
import { loadDesk } from "@/lib/data/desk";
import { formatHeaderClock, isOverdue } from "@/lib/dates";
import { useTodoStore } from "@/lib/todo-store";
import { cn } from "@/lib/utils";
import { useWorkbenchStore } from "@/lib/workbench-store";

export function Workbench() {
  const [clock, setClock] = useState(() => formatHeaderClock());
  const hydrated = useTodoStore((s) => s.hydrated);
  const items = useTodoStore((s) => s.items);
  const tab = useWorkbenchStore((s) => s.mainTab);
  const setMainTab = useWorkbenchStore((s) => s.setMainTab);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const desk = await loadDesk();
        if (cancelled) return;
        useTodoStore.getState().hydrate(desk.items);
        useWorkbenchStore.getState().hydrate({
          quotes: desk.quotes,
          parts: desk.parts,
          customers: desk.customers,
          reports: desk.reports,
        });
        const n = useTodoStore.getState().carryOver();
        if (n > 0) toast.message(`${n} 条未完成事项已顺延到明天`);
      } catch (err) {
        console.error(err);
        useTodoStore.getState().markHydrated();
        toast.error("工作台数据加载失败");
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setClock(formatHeaderClock()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const due = items.filter((it) => isOverdue(it) && it.status !== "已完成");
    if (!due.length) return;
    const key = `hq-notified-${due.map((it) => it.id).join(",")}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("客户事项提醒", {
        body: due.length > 1 ? `有 ${due.length} 条待处理事项` : `${due[0].type}「${due[0].customer}」待处理`,
      });
    }
  }, [hydrated, items]);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[11px] tracking-[0.18em] text-muted uppercase">Desk</p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">工作台</h1>
          </div>
          <div className="text-xs tabular-nums text-muted">{clock}</div>
        </div>
        <div className="mx-auto flex max-w-6xl gap-1 px-4 pb-3 sm:px-6">
          {(
            [
              { id: "todo", label: "客户待办" },
              { id: "search", label: "实时查询" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMainTab(item.id)}
              className={cn(
                "h-10 rounded-md px-4 text-sm font-medium",
                tab === item.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface hover:text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
        {tab === "todo" ? <TodoPanel /> : <SearchPanel />}
      </main>
    </div>
  );
}
