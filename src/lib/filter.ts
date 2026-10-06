import type { Candidate } from "@/lib/types";

// Cheap keyword/regex layer that kills most noise before the LLM stage.
// A candidate passes if title+text matches any demand-signal pattern.

const EN_PATTERNS: RegExp[] = [
  /\bi wish (there was|there were|someone (would|could) (make|build))\b/i,
  /\bis there (a|an|any) (tool|app|service|site|website|library|extension)\b/i,
  /\bwhy (is there no|isn'?t there a|hasn'?t (anyone|someone) (made|built))\b/i,
  /\blooking for (a|an) (tool|app|service|alternative|way to)\b/i,
  /\bdoes (anyone|anybody) know (a|an|of a) (tool|app|service|way)\b/i,
  /\bi('d| would) (pay|happily pay|gladly pay)\b/i,
  /\bsomebody (should )?make\b/i,
  /\bshut up and take my money\b/i,
  /\bfeature request\b/i,
  /\balternative to\b/i,
  /\bany (good )?(tool|app|service|recommendations?) (for|to)\b/i,
  /\bhow do (i|you|people) (deal with|handle|manage)\b/i,
  /\b(frustrat|annoying|pain point|painful|tedious|time-?consuming)\w*\b/i,
];

const ZH_PATTERNS: RegExp[] = [
  /有没有(什么|一个|一款|好用的)?(工具|软件|app|应用|服务|网站|插件|办法|方法)/i,
  /求(推荐|个|一个|一款)/,
  /(有什么|有啥)(工具|软件|app|应用|服务|网站|插件|办法|好办法|方法)/i,
  /为什么没有?人(做|开发|写)/,
  /(谁能|有人能|希望有人)(做|开发|写)(一个|个|一款)?/,
  /(愿意|我可以)(付费|花钱|掏钱)/,
  /怎么(解决|处理|搞定|应对)/,
  /(太麻烦|很麻烦|好麻烦|痛点|烦死|头疼|头痛|效率(太|很)?低)/,
  /(替代品|平替|国内(有没有|有无)类似)/,
  /(手动|人工).{0,6}(太|很|好)(累|慢|费时|费劲)/,
];

const YT_PATTERNS_EN: RegExp[] = [
  /\b(how (i|to)|my (workflow|system|setup|process))\b.*\b(spreadsheet|google sheets?|excel|notion|airtable|manually|multiple (apps|tools)|without (an? )?(app|code|coding))\b/i,
  /\bautomat\w+\b.*\b(manual|tedious|spreadsheet)\b/i,
  // "X as a database/CRM/tracker" — tool used far outside its lane
  /\b(google sheets?|spreadsheet|excel|notion|airtable)\b.*\b(as an? |instead of )?(database|crm|tracker|inventory|planner|system|template|setup)\b/i,
  /\b(template|system|setup)\b.*\b(google sheets?|excel|notion|spreadsheet|airtable)\b/i,
];

const YT_PATTERNS_ZH: RegExp[] = [
  /(用|拿).{0,8}(表格|excel|notion).{0,10}(管理|整理|记录|追踪)/i,
  /(手动|人工).{0,10}(整理|管理|流程|教程)/i,
  // 表格/笔记工具被当业务系统用
  /(excel|表格|多维表格|notion|wps).{0,12}(模板|系统|进销存|记账|排班|库存|客户|管理)/i,
  /(自动化|工作流).{0,8}(办公|教程|模板)/,
];

// Posts in these subreddits go straight to the LLM. AppIdeas/SomebodyMakeThis
// are requests by definition; in the business-owner subs people ask "Any
// suggestions?" or "What would you guys charge?", which the dev-flavoured
// patterns below miss entirely (0 of 36 LLM-confirmed demands matched in the
// 2026-10-06 probe). Their volume is low enough to classify every post.
const LLM_GATED_SUBREDDIT = new RegExp(
  `^https://www\\.reddit\\.com/r/(${[
    "SomebodyMakeThis", "AppIdeas", "shopify", "printondemand", "ecommerce",
    "FulfillmentByAmazon", "Flipping", "Contractor", "electricians",
    "PropertyManagement", "msp", "WeddingPhotography",
  ].join("|")})/`,
  "i",
);

export function isDemandSignal(c: Candidate): boolean {
  const haystack = `${c.title}\n${c.text}`;

  if (c.source === "reddit" && LLM_GATED_SUBREDDIT.test(c.url)) return true;

  if (c.source === "youtube") {
    const patterns = c.lang === "zh" ? YT_PATTERNS_ZH : YT_PATTERNS_EN;
    return patterns.some((p) => p.test(haystack));
  }

  const patterns = c.lang === "zh" ? ZH_PATTERNS : EN_PATTERNS;
  return patterns.some((p) => p.test(haystack));
}

export function filterCandidates(candidates: Candidate[]): Candidate[] {
  return candidates.filter(isDemandSignal);
}
