import { createServerFn } from "@tanstack/react-start";
import type { LookupStepKey, LookupStepResult } from "@/lib/search/result-types";

export type {
  LiveOffer,
  LookupStepKey,
  LookupStepOk,
  LookupStepResult,
  PartIdentity,
  SourceStatus,
} from "@/lib/search/result-types";

export function sourceLinks(query: string) {
  const q = encodeURIComponent(query);
  return [
    { id: "lcsc", name: "立创商城", href: `https://so.szlcsc.com/global.html?k=${q}` },
    { id: "hqew", name: "华强电子网", href: `https://s.hqew.com/${q}.html` },
    { id: "gys", name: "华强供应商", href: `https://gys.hqew.com/search/${q}.html` },
    { id: "st", name: "ST 原厂", href: `https://www.st.com/content/st_com/en/search.html#q=${q}` },
  ];
}

export const lookupStep = createServerFn({ method: "POST" })
  .validator((input: { query: string; step: LookupStepKey; shopUrl?: string; scrapeKey?: string }) => input)
  .handler(async ({ data }): Promise<LookupStepResult> => {
    const { runLookupStep } = await import("./live-lookup.server");
    return runLookupStep(data);
  });
