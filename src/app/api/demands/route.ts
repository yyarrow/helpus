import { NextResponse } from "next/server";
import { getDemands } from "@/lib/store";

export const dynamic = "force-dynamic";

// Read-only JSON API for demand cards, meant for programmatic consumers (agents).
// Auth: if DEMANDS_API_KEY is set, requires `Authorization: Bearer <key>`.
// Note: Vercel Deployment Protection sits in front of this route in production;
// callers also need a protection-bypass header unless that is disabled.
export async function GET(request: Request) {
  const key = process.env.DEMANDS_API_KEY;
  if (key) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${key}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const params = new URL(request.url).searchParams;
  const num = (name: string, max: number) => {
    const raw = params.get(name);
    if (!raw) return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : undefined;
  };

  try {
    const cards = await getDemands({
      source: params.get("source") ?? undefined,
      lang: params.get("lang") ?? undefined,
      days: num("days", 365),
      limit: num("limit", 500) ?? 100,
    });
    return NextResponse.json({ count: cards.length, cards });
  } catch (err) {
    console.error("demands api failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
