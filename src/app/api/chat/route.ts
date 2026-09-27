import { z } from "zod";
import { authenticate, consumeQuota } from "@/lib/server/auth";
import { ApiError, failure, json, readJson } from "@/lib/server/http";
import { retrieve, type Chunk } from "@/lib/research";
import { answerQuestion } from "@/lib/server/answer";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req);
    // No client-provided paper text or generated summaries are accepted.
    const { paperId, question } = z
      .object({
        paperId: z.uuid(),
        question: z.string().trim().min(3).max(2000),
      })
      .strict()
      .parse(await readJson(req));
    const { data: paper } = await ctx.db
      .from("research_papers")
      .select("id,title,coverage")
      .eq("id", paperId)
      .single();
    if (!paper) throw new ApiError(404, "Paper not found.");
    await consumeQuota(ctx, "chat");
    const [{ data, error }, { data: history, error: historyError }] =
      await Promise.all([
        ctx.db
          .from("paper_chunks")
          .select("*")
          .eq("paper_id", paperId)
          .order("ordinal"),
        ctx.db
          .from("chat_messages")
          .select("role,question,answer")
          .eq("paper_id", paperId)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);
    if (error || historyError) throw error || historyError;
    const prior = [...(history ?? [])].reverse();
    const retrievalQuery = [
      question,
      ...prior.filter((m) => m.role === "user").map((m) => m.question),
    ].join(" ");
    const passages = retrieve((data ?? []) as Chunk[], retrievalQuery);
    const answer = await answerQuestion(question, passages, prior, [paper]);
    const { error: saveError } = await ctx.db.from("chat_messages").insert([
      { owner_id: ctx.user.id, paper_id: paperId, role: "user", question },
      { owner_id: ctx.user.id, paper_id: paperId, role: "assistant", answer },
    ]);
    if (saveError) throw saveError;
    return json({ answer, passages });
  } catch (error) {
    return failure(error);
  }
}
