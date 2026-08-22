/**
 * 授权分销官方 API 适配层(P1-3 预留点)。
 *
 * Mouser: https://api.mouser.com/api/v1/search/keyword (API key 必填, 免费申请)
 * DigiKey: OAuth2 client-credentials + /Search/v3/Products/Keyword (需注册 app)
 *
 * 约定: 无 key 时返回 { status: "auth_required", detail } —— 与 icnet 同模式,
 * Skill 已约定模型遇到 auth_required 记 degrade 并换源, 不重试。
 * key 只从 env 读取(MOUSER_API_KEY / DIGIKEY_API_KEY), 不进仓库。
 */

export type AuthorizedApiResult =
  | { status: "auth_required"; detail: string }
  | { status: "ok"; offers: import("@/lib/search/result-types").LiveOffer[] }
  | { status: "empty"; detail: string }
  | { status: "error"; detail: string };

export function mouserKey(): string {
  return String(process.env.MOUSER_API_KEY || "").trim();
}

export function digikeyKey(): string {
  return String(process.env.DIGIKEY_API_KEY || "").trim();
}

/** Mouser keyword search(官方 REST)。key 未配置时短路。 */
export async function fetchMouserOffers(mpn: string): Promise<AuthorizedApiResult> {
  const key = mouserKey();
  if (!key) {
    return {
      status: "auth_required",
      detail: "未配置 MOUSER_API_KEY(https://www.mouser.com/api-search 免费申请), 配置后此源自动启用。",
    };
  }
  try {
    const res = await fetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ SearchByKeywordRequest: { keyword: mpn, records: 20, startingRecord: 0 } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { status: "error", detail: `Mouser API ${res.status}` };
    const body = (await res.json()) as {
      SearchResults?: { Parts?: Array<Record<string, unknown>> };
    };
    const parts = body.SearchResults?.Parts ?? [];
    const offers = parts.map((p) => {
      const pb = (p.PriceBreaks as Array<{ Quantity?: number; Price?: string }> | undefined) ?? [];
      const first = pb[0]?.Price ?? "";
      return {
        sourceKey: "findchips" as const, // 同为海外授权渠道, 复用 findchips 语义(USD)
        sourceName: "Mouser(官方API)",
        supplier: "Mouser Electronics",
        model: String(p.MouserPartNumber ?? mpn),
        brand: String(p.Manufacturer ?? ""),
        batch: "",
        stock: Number(p.Availability ?? 0) || null,
        price: Number(String(first).replace(/[^0-9.]/g, "")) || null,
        priceBreaks: pb.map((b) => ({ qty: Number(b.Quantity ?? 0), price: Number(String(b.Price).replace(/[^0-9.]/g, "")) })).filter((b) => b.qty > 0 && b.price > 0),
        package: String(p.Style ?? ""),
        warehouse: "authorized(API)",
        note: "USD; 官方API",
        date: new Date().toISOString().slice(0, 10),
        url: String(p.DataSheetUrl ?? "https://www.mouser.com"),
        currency: "USD" as const,
      };
    });
    if (!offers.length) return { status: "empty", detail: "Mouser 无匹配" };
    return { status: "ok", offers };
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : "mouser api failed" };
  }
}

/** DigiKey: OAuth2 流程较重, 预留接口 —— key 配置后在此补实现。 */
export async function fetchDigikeyOffers(mpn: string): Promise<AuthorizedApiResult> {
  const key = digikeyKey();
  if (!key) {
    return {
      status: "auth_required",
      detail: "未配置 DIGIKEY_API_KEY(https://developer.digikey.com 注册 App), 配置后此源自动启用。",
    };
  }
  return { status: "error", detail: "DigiKey OAuth 适配尚未实现(预留点), 请先用 findchips 聚合源。" };
}
