// Reads one object from the private Supabase bucket with the key in .env (the key never leaves this server).
import { readEnv } from "./env.js";

export async function downloadObject(objectPath, { timeoutMs = 30_000 } = {}) {
  const env = readEnv();
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_KEY;
  const bucket = env.SUPABASE_BUCKET || "mf-data";
  if (!url.startsWith("https://") || !key) throw new Error("Supabase is not configured in .env");
  const headers = { apikey: key };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  // A unique query string: Supabase's CDN can otherwise serve an earlier copy of the overwritten file.
  const response = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${objectPath}?fresh=${Date.now()}`, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Supabase answered ${response.status} for ${objectPath}`);
  return Buffer.from(await response.arrayBuffer());
}
