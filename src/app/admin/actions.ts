"use server";

import { revalidatePath } from "next/cache";
import { checkAdminPassword } from "@/lib/admin-auth";
import { setSetting, SETTINGS } from "@/lib/settings";
import { currentCookies, probeCookies, sessionCookiesJson } from "@/lib/sources/reddit";

export interface ActionState {
  ok: boolean;
  message: string;
}

const SOURCE_LABEL = { db: "后台设置", env: "环境变量", none: "未设置" } as const;

// One action for both buttons of the form; the clicked button's
// name="intent" value decides what happens. Never echoes cookie values.
export async function redditCookieAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!process.env.ADMIN_PASSWORD) {
    return { ok: false, message: "服务器未配置 ADMIN_PASSWORD，后台不可用" };
  }
  if (!checkAdminPassword(formData.get("password"))) {
    return { ok: false, message: "管理员密码错误" };
  }

  if (formData.get("intent") === "test") {
    const { json, source } = await currentCookies();
    if (!json) return { ok: false, message: "当前没有设置 Cookie" };
    const status = await probeCookies(json);
    return status === 200
      ? { ok: true, message: `当前 Cookie（来自${SOURCE_LABEL[source]}）可用：Reddit 返回 200` }
      : { ok: false, message: `当前 Cookie（来自${SOURCE_LABEL[source]}）不可用：Reddit 返回 ${status || "网络错误"}，请更新` };
  }

  if (!process.env.DATABASE_URL) {
    return { ok: false, message: "未配置 DATABASE_URL，无法保存" };
  }
  const json = sessionCookiesJson(String(formData.get("reddit_session") ?? ""));
  if (!json) {
    return { ok: false, message: "格式不对：粘贴 reddit_session 的值即可（不含空格和分号）" };
  }
  const status = await probeCookies(json);
  if (status !== 200) {
    return { ok: false, message: `Reddit 不接受这个 Cookie（${status || "网络错误"}），没有保存` };
  }
  await setSetting(SETTINGS.redditCookies, json);
  revalidatePath("/admin");
  return { ok: true, message: "已保存：Reddit 返回 200，下次抓取起生效" };
}
