import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTodoStore } from "@/lib/todo-store";
import { useWorkbenchStore } from "@/lib/workbench-store";

export function PartsPool() {
  const parts = useWorkbenchStore((s) => s.parts);
  const quotes = useWorkbenchStore((s) => s.quotes);
  const addPart = useWorkbenchStore((s) => s.addPart);
  const removePart = useWorkbenchStore((s) => s.removePart);
  const openLookup = useWorkbenchStore((s) => s.openLookup);
  const addItem = useTodoStore((s) => s.addItem);
  const [mpn, setMpn] = useState("");

  function match(mpnValue: string) {
    const rows = quotes.filter((q) => q.mpn === mpnValue);
    const names = [...new Set(rows.map((r) => r.customer))];
    return names;
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
        <h2 className="text-base font-semibold">主推型号池</h2>
        <p className="mt-1 text-xs text-muted">从报告加入，或自己登记。匹配看谁询过这颗料。</p>
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const row = addPart({ mpn });
            if (!row) toast.error("请填写型号");
            else {
              setMpn("");
              toast.success(`已加入 ${row.mpn}`);
            }
          }}
        >
          <label className="grid min-w-40 flex-1 gap-1.5">
            <Label>型号</Label>
            <Input value={mpn} onChange={(e) => setMpn(e.target.value)} placeholder="STM32F103C8T6" />
          </label>
          <Button type="submit" className="self-end">
            加入
          </Button>
        </form>
      </section>

      {!parts.length ? (
        <p className="text-sm text-muted">池子还空。查完行情可以点「加入主推池」。</p>
      ) : (
        <ul className="grid gap-3">
          {parts.map((p) => {
            const names = match(p.mpn);
            return (
              <li key={p.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{p.mpn}</p>
                    <p className="mt-1 text-xs text-muted">
                      {[p.brand, p.category].filter(Boolean).join(" · ") || "未标品牌"}
                    </p>
                    {names.length ? (
                      <p className="mt-2 text-xs text-ink">
                        曾询价 {names.join("、")}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted">还没有客户询过这颗料</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => openLookup(p.mpn, "part")}>
                      查行情
                    </Button>
                    {names.map((name) => (
                      <Button
                        key={name}
                        type="button"
                        size="sm"
                        onClick={() => {
                          addItem({
                            customer: name,
                            type: "报价",
                            content: `主推 ${p.mpn}${p.brand ? `（${p.brand}）` : ""}`,
                            amount: null,
                            dueAt: null,
                          });
                          toast.success(`已转待办给 ${name}`);
                        }}
                      >
                        转给 {name}
                      </Button>
                    ))}
                    <Button type="button" size="sm" variant="ghost" onClick={() => removePart(p.id)}>
                      移出
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
