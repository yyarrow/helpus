import { getDemands, getClusterStats } from "@/lib/store";
import type { DemandCard } from "@/lib/types";

export const dynamic = "force-dynamic";

function buildQueryString(
  source?: string,
  lang?: string,
  days?: string,
  view?: string
): string {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (lang) params.set("lang", lang);
  if (days) params.set("days", days);
  if (view) params.set("view", view);
  const query = params.toString();
  return query ? "?" + query : "/";
}

function FilterPill({
  label,
  isActive,
  href,
}: {
  label: string;
  isActive: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      className={`inline-block px-3 py-1 rounded-full text-sm font-medium transition-colors ${
        isActive
          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black"
          : "border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600"
      }`}
    >
      {label}
    </a>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; lang?: string; days?: string; view?: string }>;
}) {
  const params = await searchParams;
  const source = params.source;
  const lang = params.lang;
  const daysStr = params.days;
  const days = daysStr ? Number(daysStr) : undefined;
  const view = params.view;

  const demands = await getDemands({ source, lang, days, limit: 200 });
  const clusters = view === "clusters" ? await getClusterStats(100) : [];

  // Count by source
  const countBySource = demands.reduce(
    (acc, d) => {
      acc[d.source] = (acc[d.source] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Helper function to format relative date
  function formatRelativeDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "今天";
    if (diffDays === 1) return "昨天";
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}个月前`;
    return `${Math.floor(diffDays / 365)}年前`;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 py-8">
        <div className="max-w-3xl mx-auto px-4">
          <h1 className="text-3xl font-semibold mb-2">HelpUs · 需求雷达</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            从 HN / Reddit / V2EX / GitHub / YouTube 挖掘的真实需求
          </p>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 py-6">
        <div className="max-w-3xl mx-auto px-4 space-y-4">
          {/* View Toggle */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              视图:
            </span>
            <FilterPill
              label="需求卡"
              isActive={!view}
              href={buildQueryString(source, lang, daysStr, undefined)}
            />
            <FilterPill
              label="需求簇"
              isActive={view === "clusters"}
              href={buildQueryString(source, lang, daysStr, "clusters")}
            />
          </div>

          {/* Source */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              来源:
            </span>
            <FilterPill
              label="全部"
              isActive={!source}
              href={buildQueryString(undefined, lang, daysStr)}
            />
            {["hn", "reddit", "v2ex", "github", "youtube"].map((s) => (
              <FilterPill
                key={s}
                label={s.toUpperCase()}
                isActive={source === s}
                href={buildQueryString(s, lang, daysStr)}
              />
            ))}
          </div>

          {/* Language */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              语言:
            </span>
            <FilterPill
              label="全部"
              isActive={!lang}
              href={buildQueryString(source, undefined, daysStr)}
            />
            <FilterPill
              label="中文"
              isActive={lang === "zh"}
              href={buildQueryString(source, "zh", daysStr)}
            />
            <FilterPill
              label="English"
              isActive={lang === "en"}
              href={buildQueryString(source, "en", daysStr)}
            />
          </div>

          {/* Time */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              时间:
            </span>
            <FilterPill
              label="全部"
              isActive={!days}
              href={buildQueryString(source, lang, undefined)}
            />
            <FilterPill
              label="24h"
              isActive={days === 1}
              href={buildQueryString(source, lang, "1")}
            />
            <FilterPill
              label="7天"
              isActive={days === 7}
              href={buildQueryString(source, lang, "7")}
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 py-4">
        <div className="max-w-3xl mx-auto px-4 text-sm text-zinc-600 dark:text-zinc-400">
          共{" "}
          <span className="font-semibold text-black dark:text-white">
            {demands.length}
          </span>{" "}
          条{" "}
          {Object.entries(countBySource).map(([src, count], idx) => (
            <span key={src}>
              {idx > 0 && " · "}
              {src.toUpperCase()}: {count}
            </span>
          ))}
        </div>
      </div>

      {/* Card/Cluster List */}
      <main className="py-8">
        {view === "clusters" ? (
          // Cluster View
          clusters.length === 0 ? (
            <div className="max-w-3xl mx-auto px-4">
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-8 text-center">
                <p className="text-zinc-600 dark:text-zinc-400 mb-2">暂无数据</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-500">
                  运行{" "}
                  <code className="bg-zinc-100 dark:bg-zinc-900 px-2 py-1 rounded text-xs">
                    curl http://localhost:3000/api/cron/ingest
                  </code>{" "}
                  开始挖掘需求
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 space-y-4">
              {clusters.map((cluster) => (
                <article
                  key={cluster.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  {/* Title */}
                  <h2 className="text-lg font-medium mb-2 text-black dark:text-white">
                    {cluster.title}
                  </h2>

                  {/* Summary */}
                  {cluster.summary && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                      {cluster.summary}
                    </p>
                  )}

                  {/* Category Tag */}
                  {cluster.category && (
                    <div className="mb-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                        {cluster.category}
                      </span>
                    </div>
                  )}

                  {/* Badge Row */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    {/* Card Count */}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                      {cluster.cardCount} 卡片
                    </span>

                    {/* Source Count - highlight if >= 2 */}
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-medium ${
                        cluster.sourceCount >= 2
                          ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                          : "bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      {cluster.sourceCount} 来源
                    </span>

                    {/* Strong Pay Count - only if > 0 */}
                    {cluster.strongPayCount > 0 && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-medium bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                        {cluster.strongPayCount} 愿付费
                      </span>
                    )}

                    {/* Last Seen Date */}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                      {formatRelativeDate(cluster.lastSeenAt)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )
        ) : (
          // Card View (original)
          demands.length === 0 ? (
            <div className="max-w-3xl mx-auto px-4">
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-8 text-center">
                <p className="text-zinc-600 dark:text-zinc-400 mb-2">暂无数据</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-500">
                  运行{" "}
                  <code className="bg-zinc-100 dark:bg-zinc-900 px-2 py-1 rounded text-xs">
                    curl http://localhost:3000/api/cron/ingest
                  </code>{" "}
                  开始挖掘需求
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 space-y-4">
              {demands.map((card) => (
                <article
                  key={card.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                >
                  {/* Headline */}
                  <h2 className="text-lg font-medium mb-3 text-black dark:text-white">
                    {card.demand}
                  </h2>

                  {/* Chips Row */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {/* Source Badge */}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                      {card.source.toUpperCase()}
                    </span>

                    {/* Category */}
                    {card.category && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                        {card.category}
                      </span>
                    )}

                    {/* Language */}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                      {card.lang === "zh" ? "中文" : "EN"}
                    </span>

                    {/* Pay Signal */}
                    {card.paySignal === "strong" && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                        💰 愿付费
                      </span>
                    )}
                    {card.paySignal === "weak" && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400">
                        可能付费
                      </span>
                    )}

                    {/* Confidence */}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
                      {Math.round(card.confidence * 100)}%
                    </span>
                  </div>

                  {/* Audience & Scenario */}
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                    {[card.audience, card.scenario].filter(Boolean).join(" · ")}
                  </p>

                  {/* Footer */}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-500 pt-4 border-t border-zinc-100 dark:border-zinc-900">
                    <span>▲{card.score}</span>
                    <span>💬{card.numComments}</span>
                    <span>{new Date(card.postedAt).toISOString().split("T")[0]}</span>
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline ml-auto"
                    >
                      原帖 ↗
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  );
}
