<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# HelpUs · 需求雷达

从 HN / Reddit / V2EX / GitHub 定时挖掘"真实需求"帖子，LLM 归一化成需求卡片，Web 看板展示。

## 架构（管道四段）

1. **抓取** `src/lib/sources/{hn,reddit,v2ex,github}.ts` — 每个源导出 `fetchCandidates(): Promise<Candidate[]>`，只用公开 API，失败降级为空数组。
2. **过滤** `src/lib/filter.ts` — 中英文正则捞"痛点表达"，进 LLM 前干掉大部分噪音。
3. **提炼** `src/lib/classify.ts` — OpenRouter + `google/gemini-3.8-flash`（`DEMAND_MODEL` 可覆盖），批量把候选变成 `DemandCard`；没有 `OPENROUTER_API_KEY` 时降级为 pass-through（category=unclassified）。
4. **存储** `src/lib/store.ts` — 有 `DATABASE_URL` 走 Neon Postgres（自动建表），否则写本地 `.data/demands.json`（已 gitignore）。

入口：`/api/cron/ingest`（Vercel Cron 每 6 小时，见 vercel.json；设了 `CRON_SECRET` 就校验 Bearer）。看板：`/`（server component，URL 参数筛选 source/lang/days）。

## 本地跑

```sh
npm run dev   # 然后 curl http://localhost:3000/api/cron/ingest 触发一次抓取
```

## 坑

- **本地访问 HN/Reddit 等要走代理**：Node fetch 不认代理环境变量，必须加 `NODE_USE_ENV_PROXY=1 HTTP_PROXY=http://127.0.0.1:12334 HTTPS_PROXY=http://127.0.0.1:12334`。Vercel 上不需要。
- **Reddit 匿名 .json 对机房 IP 一律 403**（换浏览器 UA 也没用）。设置 `REDDIT_COOKIES_JSON`（Reddit 登录 Cookie 的 name→value JSON，须含 `reddit_session`；本地 `.env.local`，生产 Vercel env）后带 Cookie + Chrome headers 请求；格式错误时整个源跳过、不回退匿名。用小号的 Cookie，会过期，过期后 Reddit 源归零需重新导出。官方 API 自 2025-11 起不再开放自助注册。
- **ai 包是 v7**：`generateObject` 已移除，结构化输出用 `generateText` + `Output.array({ element })`，结果读 `result.output`。AI SDK 用法别凭记忆写，查 `node_modules/ai/docs/`。
- LLM 分类需要 `OPENROUTER_API_KEY`（本地放 `.env.local`，生产放 Vercel env），没有就跳过分类。走 OpenRouter 时本地同样要过代理。

## 部署

Vercel（账号 yuanyanva-7250）。Cron 只在 production 部署生效。环境变量见 `.env.example`；`DATABASE_URL` 用 Neon（Vercel Marketplace）。

## 方向(2026-08 起)

产品定位从"技术圈需求雷达"进化为"付费需求雷达":现有四源全是开发者自留地(付费意愿最低人群),要向大众需求侧信号扩展。新信号源优先级、现有源已知偏差、卡片新字段(宿主依附度/人肉成交证据)见 `docs/signal-roadmap.md`——动信号源或筛选逻辑前先读它。
