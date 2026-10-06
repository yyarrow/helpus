import Link from "next/link";
import { getSetting, SETTINGS } from "@/lib/settings";
import type { RedditFetchReport } from "@/lib/sources/reddit";
import { RedditCookieForm } from "./reddit-cookie-form";

export const dynamic = "force-dynamic";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export default async function AdminPage() {
  const [cookie, lastFetch] = await Promise.all([
    getSetting(SETTINGS.redditCookies).catch(() => null),
    getSetting(SETTINGS.redditLastFetch).catch(() => null),
  ]);
  const report: RedditFetchReport | null = lastFetch ? JSON.parse(lastFetch.value) : null;
  const failed = report ? Object.entries(report.failed) : [];
  const blocked = failed.filter(([, status]) => status === 401 || status === 403).length;

  const cookieSource = cookie
    ? `后台设置，${formatTime(cookie.updatedAt)} 更新`
    : process.env.REDDIT_COOKIES_JSON
      ? "环境变量 REDDIT_COOKIES_JSON"
      : "未设置（匿名请求会被 403）";

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white">
      <header className="border-b border-zinc-200 dark:border-zinc-800 py-8">
        <div className="max-w-3xl mx-auto px-4">
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← 返回看板
          </Link>
          <h1 className="text-3xl font-semibold mt-2">后台</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Reddit Cookie</h2>
          <dl className="text-sm space-y-1 text-zinc-700 dark:text-zinc-300">
            <div>
              <dt className="inline text-zinc-500">当前来源：</dt>
              <dd className="inline">{cookieSource}</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500">上次抓取：</dt>
              <dd className="inline">
                {report
                  ? `${formatTime(report.at)}，${report.okSubreddits}/${report.totalSubreddits} 个版块成功，${report.candidates} 帖`
                  : "暂无记录"}
              </dd>
            </div>
            {failed.length > 0 && (
              <div>
                <dt className="inline text-zinc-500">失败版块：</dt>
                <dd className="inline">{failed.map(([sub, status]) => `r/${sub} (${status || "网络错误"})`).join("、")}</dd>
              </div>
            )}
          </dl>
          {blocked > 0 && (
            <p className="text-sm text-red-700 dark:text-red-400">
              {blocked} 个版块被拒（401/403），Cookie 很可能已过期，请更新。
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="font-medium">更新 Cookie</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            用小号登录 reddit.com，在 DevTools → Application → Cookies → https://www.reddit.com 里复制
            reddit_session 的值。保存前会先用它请求一次 Reddit，返回 200 才会写入。
          </p>
          <RedditCookieForm />
        </section>
      </main>
    </div>
  );
}
