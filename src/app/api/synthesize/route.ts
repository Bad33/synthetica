import { z } from "zod";
import { authenticate, consumeQuota } from "@/lib/server/auth";
import { ApiError, failure, json, readJson } from "@/lib/server/http";
import { retrieve, type Chunk } from "@/lib/research";
import { answerQuestion } from "@/lib/server/answer";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req);
    const { paperIds, question } = z
      .object({
        paperIds: z.array(z.uuid()).min(2).max(6),
        question: z.string().trim().min(10).max(2000),
      })
      .parse(await readJson(req));
    const ids = [...new Set(paperIds)];
    if (ids.length < 2)
      throw new ApiError(400, "Choose at least two different papers.");
    const { data: papers, error } = await ctx.db
      .from("research_papers")
      .select("id,title,coverage")
      .in("id", ids);
    if (error || papers?.length !== ids.length)
      throw new ApiError(404, "One or more papers are unavailable.");
    await consumeQuota(ctx, "synthesize");
    // Fetch each paper separately so PostgREST's row cap cannot silently omit later papers.
    const retrieved = await Promise.all(
      ids.map(async (id) => {
        const { data, error } = await ctx.db
          .from("paper_chunks")
          .select("*")
          .eq("paper_id", id)
          .order("ordinal")
          .limit(1000);
        if (error) throw error;
        return retrieve((data ?? []) as Chunk[], question, 5);
      }),
    );
    const passages = retrieved.flat();
    const answer = await answerQuestion(question, passages, [], papers);
    // A cross-paper assertion must cite at least two selected papers.
    const source = new Map(passages.map((p) => [p.id, p.paper_id]));
    answer.claims = answer.claims.filter(
      (c) =>
        new Set(c.citations.map((ref) => source.get(ref.chunkId))).size >= 2,
    );
    if (!answer.claims.length) answer.status = "unavailable";
    return json({ answer, passages, papers });
  } catch (error) {
    return failure(error);
  }
}
