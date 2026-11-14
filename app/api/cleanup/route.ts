import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

// Runs once a day (see vercel.json).
//  - storage >= 50% of the quota: delete chat photos/videos/files older than 30 days
//  - storage >= 70% of the quota: delete the oldest ones right away until usage is back to 50%
// Voice notes and profile pictures are never deleted.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "missing env vars" }, { status: 500 });
  }

  const sb: any = createClient(url, key, { auth: { persistSession: false } });
  const quota = Number(process.env.STORAGE_QUOTA_MB || 1024) * MB;

  const usage = await sb.rpc("storage_usage_bytes");
  if (usage.error) return NextResponse.json({ error: usage.error.message }, { status: 500 });

  let used = Number(usage.data) || 0;
  const startRatio = used / quota;

  if (startRatio < 0.5) {
    return NextResponse.json({ action: "none", usedMB: Math.round(used / MB), ratio: startRatio });
  }

  const urgent = startRatio >= 0.7;
  const cutoff = Date.now() - 30 * DAY;
  let deleted = 0;
  let freed = 0;

  for (let round = 0; round < 20; round++) {
    const { data, error } = await sb.rpc("media_oldest", { p_limit: 500 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    const batch: { name: string; size: number }[] = [];
    for (const f of data as { name: string; size: number; created_at: string }[]) {
      if (urgent) {
        if (used - freed <= quota * 0.5) break;
      } else if (new Date(f.created_at).getTime() > cutoff) {
        break;
      }
      batch.push({ name: f.name, size: Number(f.size) || 0 });
      freed += Number(f.size) || 0;
    }
    if (batch.length === 0) break;

    const paths = batch.map(b => b.name);
    const rm = await sb.storage.from("media").remove(paths);
    if (rm.error) return NextResponse.json({ error: rm.error.message }, { status: 500 });

    // The message stays in the chat, but its file is gone.
    await sb.from("messages").update({ media_path: null }).in("media_path", paths);
    deleted += paths.length;

    if (data.length < 500) break;
  }

  return NextResponse.json({
    action: urgent ? "urgent" : "monthly",
    deletedFiles: deleted,
    freedMB: Math.round(freed / MB),
    usedBeforeMB: Math.round(used / MB),
  });
}
