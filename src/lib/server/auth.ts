import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./http";

export async function authenticate(req: Request) {
  const token = req.headers
    .get("authorization")
    ?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) throw new ApiError(401, "Sign in to continue.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new ApiError(503, "Authentication is not configured.");
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new ApiError(401, "Your session expired. Sign in again.");
  return { db, user: data.user };
}
export type Context = Awaited<ReturnType<typeof authenticate>>;
export async function consumeQuota(
  ctx: Context,
  action: "ingest" | "analyze" | "chat" | "synthesize",
) {
  const { data, error } = await ctx.db.rpc("consume_research_quota", {
    action_name: action,
  });
  if (error)
    throw new ApiError(503, "Usage limits are unavailable. Try again later.");
  if (data !== true)
    throw new ApiError(
      429,
      "Your hourly research limit has been reached. Try again next hour.",
    );
}
