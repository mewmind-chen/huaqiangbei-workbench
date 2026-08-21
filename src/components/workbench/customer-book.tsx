import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkbenchStore } from "@/lib/workbench-store";

export function CustomerBook() {
  const customers = useWorkbenchStore((s) => s.customers);
  const quotes = useWorkbenchStore((s) => s.quotes);
  const addCustomer = useWorkbenchStore((s) => s.addCustomer);
  const removeCustomer = useWorkbenchStore((s) => s.removeCustomer);
  const openLookup = useWorkbenchStore((s) => s.openLookup);
  const [name, setName] = useState("");

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
        <h2 className="text-base font-semibold">客户名册</h2>
        <p className="mt-1 text-xs text-muted">记报价待办时会自动收录客户名。</p>
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const row = addCustomer(name);
            if (!row) toast.error("请填写客户名");
            else {
              setName("");
              toast.success(`已收录 ${row.name}`);
            }
          }}
        >
          <label className="grid min-w-40 flex-1 gap-1.5">
            <Label>客户</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="张老板 / 公司名" />
          </label>
          <Button type="submit" className="self-end">
            收录
          </Button>
        </form>
      </section>

      {!customers.length ? (
        <p className="text-sm text-muted">还没有客户。先记一条报价待办即可。</p>
      ) : (
        <ul className="grid gap-3">
          {customers.map((c) => {
            const lines = quotes.filter((q) => q.customer === c.name);
            const open = lines.filter((q) => q.status !== "已完成");
            return (
              <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{c.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {open.length ? `在跟 ${open.map((q) => q.mpn).join("、")}` : "暂无未完成询价"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {open[0] ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openLookup(open[0].mpn, "part")}
                      >
                        查行情
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeCustomer(c.id)}>
                      删除
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
