import { NextResponse } from "next/server";
import { runIngest } from "@/lib/pipeline";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Triggered by Vercel Cron (Authorization: Bearer CRON_SECRET) or manually in dev.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const stats = await runIngest();
    console.log("ingest done", stats);
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("ingest failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
