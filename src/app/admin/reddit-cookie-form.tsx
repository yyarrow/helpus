"use client";

import { useActionState } from "react";
import { redditCookieAction, type ActionState } from "./actions";

const initialState: ActionState = { ok: false, message: "" };

const inputClass =
  "w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm";

export function RedditCookieForm() {
  const [state, formAction, pending] = useActionState(redditCookieAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">reddit_session</span>
        <input
          type="password"
          name="reddit_session"
          autoComplete="off"
          placeholder="DevTools → Application → Cookies → reddit.com"
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">管理员密码</span>
        <input type="password" name="password" autoComplete="current-password" required className={inputClass} />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="rounded-md bg-black dark:bg-white text-white dark:text-black px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? "处理中…" : "验证并保存"}
        </button>
        <button
          type="submit"
          name="intent"
          value="test"
          disabled={pending}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          测试当前 Cookie
        </button>
      </div>
      {state.message && (
        <p
          aria-live="polite"
          className={`text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
