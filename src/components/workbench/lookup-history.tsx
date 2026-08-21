import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatShort } from "@/lib/dates";
import { useWorkbenchStore } from "@/lib/workbench-store";

export function LookupHistory() {
  const reports = useWorkbenchStore((s) => s.reports);
  const openReport = useWorkbenchStore((s) => s.openReport);
  const openLookup = useWorkbenchStore((s) => s.openLookup);
  const removeReport = useWorkbenchStore((s) => s.removeReport);

  if (!reports.length) {
    return (
      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-base font-semibold">查询记录</h2>
        <p className="mt-2 text-sm text-muted">查完的型号和公司会写入工作台数据库。点开就能回看当时的分析，不用再抓一遍。</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
      <h2 className="text-base font-semibold">查询记录</h2>
      <p className="mt-1 text-xs text-muted">最近 {reports.length} 次。打开看报告，再查会重新抓公开页。</p>
      <ul className="mt-4 grid gap-3">
        {reports.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-surface-2 p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold">{r.query}</p>
              <p className="mt-1 text-xs text-muted">
                {r.kind === "part" ? "型号" : "公司"} · {formatShort(r.createdAt)}
                {r.summary ? ` · ${r.summary}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => openReport(r.id)}>
                打开报告
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => openLookup(r.query, r.kind)}>
                再查
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  removeReport(r.id);
                  toast.message("已删这条记录");
                }}
              >
                删除
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
