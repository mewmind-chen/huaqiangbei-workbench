import { create } from "zustand";
import { upsertItem, upsertItems, removeItem } from "@/lib/data/desk";
import type { ItemStatus, ItemType, TodoItem } from "@/lib/types";
import { addDaysKeepTime, defaultDue, isPastDay, nowLocal } from "@/lib/dates";
import { useWorkbenchStore } from "@/lib/workbench-store";

type Draft = {
  customer: string;
  type: ItemType;
  content: string;
  amount: string;
  dueAt: string;
};

type State = {
  items: TodoItem[];
  hydrated: boolean;
  initialized: boolean;
  addItem: (input: {
    customer: string;
    type: ItemType;
    content: string;
    amount: number | null;
    dueAt?: string | null;
  }) => TodoItem;
  updateItem: (id: string, patch: Partial<TodoItem>) => TodoItem | null;
  deleteItem: (id: string) => void;
  setStatus: (id: string, status: ItemStatus) => TodoItem | null;
  carryOver: () => number;
  hydrate: (items: TodoItem[]) => void;
  markHydrated: () => void;
};

const emptyDraft = (): Draft => ({
  customer: "",
  type: "报价",
  content: "",
  amount: "",
  dueAt: "",
});

function uid() {
  return crypto.randomUUID();
}

function save(item: TodoItem) {
  void upsertItem({ data: item }).catch((err) => console.error(err));
}

export const useTodoStore = create<State>()((set, get) => ({
  items: [],
  hydrated: false,
  initialized: false,
  hydrate: (items) => set({ items, hydrated: true, initialized: true }),
  addItem: (input) => {
    const dueAt = input.dueAt || defaultDue();
    const item: TodoItem = {
      id: uid(),
      customer: input.customer.trim(),
      type: input.type,
      content: input.content.trim(),
      amount: input.amount,
      status: "待处理",
      dueAt,
      dueDefault: !input.dueAt,
      createdAt: nowLocal(),
      doneAt: null,
      carryCount: 0,
      dueOrig: dueAt,
    };
    set({ items: [item, ...get().items] });
    save(item);
    useWorkbenchStore.getState().captureFromItem(item);
    return item;
  },
  updateItem: (id, patch) => {
    let next: TodoItem | null = null;
    set({
      items: get().items.map((it) => {
        if (it.id !== id) return it;
        next = {
          ...it,
          ...patch,
          customer: (patch.customer ?? it.customer).trim(),
        };
        return next;
      }),
    });
    if (next) save(next);
    return next;
  },
  deleteItem: (id) => {
    set({ items: get().items.filter((it) => it.id !== id) });
    void removeItem({ data: { id } }).catch((err) => console.error(err));
  },
  setStatus: (id, status) => {
    const row = get().items.find((it) => it.id === id);
    if (!row) return null;
    if (status === "已完成") useWorkbenchStore.getState().closeFromItem(row);
    return get().updateItem(id, {
      status,
      doneAt: status === "已完成" ? nowLocal() : null,
    });
  },
  carryOver: () => {
    let n = 0;
    const next = get().items.map((it) => {
      if (it.status === "已完成" || !isPastDay(it.dueAt)) return it;
      n += 1;
      const nextDue = addDaysKeepTime(it.dueAt, 1);
      return {
        ...it,
        dueAt: nextDue,
        carryCount: it.carryCount + 1,
        dueOrig: it.dueOrig || it.dueAt,
      };
    });
    if (n) {
      set({ items: next });
      void upsertItems({ data: next }).catch((err) => console.error(err));
    }
    return n;
  },
  markHydrated: () => set({ hydrated: true, initialized: true }),
}));

export { emptyDraft };
export type { Draft };
