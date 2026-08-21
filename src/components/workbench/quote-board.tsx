import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkbenchStore } from "@/lib/workbench-store";
import type { QuoteStatus } from "@/lib/types";

const NEXT: Record<QuoteStatus, QuoteStatus | null> = {
  待报价: "已报价",
  已报价: "已完成",
  已完成: null,
};

export function QuoteBoard() {
  const quotes = useWorkbenchStore((s) => s.quotes);
  const setQuoteStatus = useWorkbenchStore((s) => s.setQuoteStatus);
  const openLookup = useWorkbenchStore((s) => s.openLookup);
  const open = quotes.filter((q) => q.status !== "已完成");

  if (!open.length) {
    return (
      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-base font-semibold">待报价</h2>
        <p className="mt-2 text-sm text-muted">
          在待办里记一条「报价」并写上型号，这里会抽出客户 × 型号。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
      <h2 className="text-base font-semibold">待报价</h2>
      <p className="mt-1 text-xs text-muted">按客户 × 型号跟进。查行情跳到公开挂货。</p>
      <ul className="mt-4 grid gap-3">
        {open.map((q) => (
          <li
            key={q.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-surface-2 p-3"
          >
            <div>
              <p className="text-sm font-medium">
                {q.customer} × {q.mpn}
              </p>
              {q.content ? <p className="mt-1 text-xs text-muted">{q.content}</p> : null}
              <Badge variant={q.status === "已报价" ? "progress" : "pending"} className="mt-2">
                {q.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => openLookup(q.mpn, "part")}>
                查行情
              </Button>
              {NEXT[q.status] ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setQuoteStatus(q.id, NEXT[q.status]!);
                    toast.success(`已标为${NEXT[q.status]}`);
                  }}
                >
                  {NEXT[q.status]}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
