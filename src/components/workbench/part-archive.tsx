import { Badge } from "@/components/ui/badge";
import { buildDossier } from "@/lib/search/part-dossier";
import type { LcscAlt } from "@/lib/search/md-parse";
import type { IntelBrief, PartIdentity } from "@/lib/search/result-types";

export function PartArchive({
  identity,
  alts,
  intel,
}: {
  identity: PartIdentity;
  alts: LcscAlt[];
  intel?: IntelBrief | null;
}) {
  const d = buildDossier(identity, alts, intel);
  const extra = d.extra;

  return (
    <section className="rounded-xl border border-line bg-surface p-4 lg:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-muted">型号档案</p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">{identity.mpn}</h3>
          <p className="mt-1 text-sm text-muted">
            {[identity.brand, identity.category, identity.package, identity.lcscCode && `立创 ${identity.lcscCode}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {identity.active ? <Badge variant="done">在产</Badge> : null}
            {identity.longevity ? <Badge variant="progress">寿命标到 {identity.longevity}</Badge> : null}
            {extra?.family ? <Badge variant="outline">{extra.family}</Badge> : null}
            {identity.package ? <Badge variant="outline">{identity.package}</Badge> : null}
          </div>
        </div>
        {identity.imageUrl ? (
          <a
            href={identity.lcscUrl || undefined}
            target="_blank"
            rel="noreferrer"
            className="shrink-0"
            title="立创商品图（点击打开商品页）"
          >
            <img
              src={identity.imageUrl}
              alt={`${identity.mpn} 封装图`}
              loading="lazy"
              className="h-24 w-24 rounded-lg border border-line bg-white object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </a>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6">
        <div>
          <h4 className="text-sm font-semibold">这是什么</h4>
          <p className="mt-2 text-sm leading-relaxed">{d.headline}</p>
          {extra?.what && extra.what !== d.headline ? (
            <p className="mt-2 text-sm leading-relaxed text-ink">{extra.what}</p>
          ) : null}
          {identity.features && identity.features !== d.headline ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">{identity.features}</p>
          ) : identity.desc && identity.desc !== identity.summary ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">{identity.desc}</p>
          ) : null}
          {d.positioning ? <p className="mt-2 text-xs text-faint">{d.positioning}</p> : null}
        </div>

        {d.specs.length ? (
          <div>
            <h4 className="text-sm font-semibold">规格参数</h4>
            <p className="mt-1 text-xs text-muted">自立创商品参数表抽出，报价前仍以规格书为准。</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {d.specs.map((s) => (
                <div key={s.label} className="border-b border-line pb-2">
                  <dt className="text-xs text-muted">{s.label}</dt>
                  <dd className="mt-0.5 text-sm font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {d.apps.length || extra?.use ? (
          <div>
            <h4 className="text-sm font-semibold">应用</h4>
            {extra?.use ? <p className="mt-2 text-sm leading-relaxed">{extra.use}</p> : null}
            {d.apps.length ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {d.apps.map((a) => (
                  <li key={a.raw} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <p className="text-sm font-medium">{a.zh}</p>
                    {a.who ? <p className="mt-0.5 text-xs text-muted">{a.who}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {extra?.customers || d.who.length ? (
              <p className="mt-3 text-sm text-muted">
                常见询价客户：{extra?.customers || d.who.join("、")}
              </p>
            ) : null}
          </div>
        ) : null}

        {extra || d.replacements.length || d.liveNotes.length ? (
          <div>
            <h4 className="text-sm font-semibold">拓展</h4>
            {d.liveNotes.length ? (
              <ul className="mt-2 grid gap-2 text-sm leading-relaxed">
                {d.liveNotes.map((n) => (
                  <li key={n} className="border-l-2 border-line pl-3">
                    {n}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">这颗料还没有补充说明，上面规格和立创替代可先用。</p>
            )}
            {intel?.hits.length ? (
              <p className="mt-3 text-xs text-muted">
                拓展来自立创参数和公开网页对照，报价仍以规格书和挂货为准。
              </p>
            ) : null}
            {d.replacements.length ? (
              <div className="mt-4">
                <p className="text-xs text-muted">立创页上的相似 / 替代（不是保证脚位兼容）</p>
                <ul className="mt-2 grid gap-1 text-sm">
                  {d.replacements.map((a) => (
                    <li key={a.mpn} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {a.mpn} <span className="text-muted">{a.brand}</span>
                      </span>
                      <span className="text-xs text-faint">{a.similarity || a.package}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {extra?.related.length ? (
              <p className="mt-3 text-xs text-muted">常一起问：{extra.related.join("、")}</p>
            ) : null}
          </div>
        ) : null}

        {identity.active || identity.longevity ? (
          <div>
            <h4 className="text-sm font-semibold">生命周期</h4>
            <p className="mt-2 text-sm">
              {identity.active ? "原厂标在产。" : "原厂页未标 Active。"}
              {identity.longevity ? ` 寿命计划标到 ${identity.longevity}。` : ""}
            </p>
          </div>
        ) : null}

        {identity.lcscUrl || identity.stUrl ? (
          <p className="text-xs text-muted">
            {identity.lcscUrl ? (
              <a href={identity.lcscUrl} target="_blank" rel="noreferrer" className="hover:underline">
                立创商品页
              </a>
            ) : null}
            {identity.lcscUrl && identity.stUrl ? " · " : null}
            {identity.stUrl ? (
              <a href={identity.stUrl} target="_blank" rel="noreferrer" className="hover:underline">
                原厂页
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}
