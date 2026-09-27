import {
  answerSchema,
  unavailable,
  validateClaims,
  type Chunk,
  type Answer,
} from "../research";
import { generate } from "./ai";
import { qaPrompt } from "../prompts/research";
import { ApiError } from "./http";
export async function answerQuestion(
  question: string,
  passages: Chunk[],
  history: unknown[] = [],
  papers: { id: string; title: string; coverage?: string }[] = [],
): Promise<Answer> {
  if (!passages.length) return unavailable();
  const parsed = answerSchema.safeParse(
    await generate(qaPrompt, { question, passages, history, papers }, "qa"),
  );
  if (!parsed.success)
    throw new ApiError(502, "The answer could not be validated. Please retry.");
  if (parsed.data.status === "unavailable") return unavailable();
  const claims = validateClaims(parsed.data.claims, passages);
  return claims.length ? { status: "supported", claims } : unavailable();
}
