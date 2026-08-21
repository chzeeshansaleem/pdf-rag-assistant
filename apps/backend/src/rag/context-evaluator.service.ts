import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PromptService } from './prompt.service';
import { OPENAI_CLIENT } from '../common/openai-client.provider';
import { RetrievedChunk } from './interfaces/retrieved-chunk.interface';
import { ContextEvaluation } from './interfaces/context-evaluation.interface';

const EVALUATOR_SYSTEM_PROMPT = `You are a retrieval quality evaluator for a document question-answering system.

Given a user's question and the document chunks retrieved for it, judge whether the chunks contain enough information for a helpful, reasonably grounded answer.

Respond with ONLY a JSON object — no other text, no markdown code fences:
{"sufficient": boolean, "reason": "one short sentence explaining your judgment", "refinedQuery": "a better search query targeting the missing information, or omit this field if sufficient is true"}

Rules:
1. sufficient = true if the context addresses the core of what's being asked, even if it doesn't cover every nuance or sub-detail. The context does not need to be a complete, exhaustive answer — a real chat model reading this same context will reasonably synthesize and lightly extrapolate a helpful answer from it, so judge against that bar, not against a textbook-perfect one.
2. sufficient = false only when the context is genuinely unrelated to the question, or so thin that any answer drawn from it would be pure guesswork rather than grounded in what's actually there.
3. Be especially lenient on short, vague follow-up questions in a conversation (e.g. "how do I request it?", "what if I need it urgently?", "do I need to provide anything?") — if the context covers the general topic being followed up on, treat it as sufficient rather than demanding it spell out every implied sub-question.
4. refinedQuery must describe what is MISSING, phrased as a standalone search query — not just a rephrasing of the original question. Example: if the question asks about leave carry-forward and the context only covers how much leave employees get, refinedQuery should target "leave carry-forward / unused leave rollover policy", not repeat the original question.
5. Do not attempt to answer the user's question yourself — only evaluate and (if needed) suggest what to search for next.
6. If there are no retrieved chunks at all, sufficient is always false.`;

/**
 * ContextEvaluatorService — the "is this enough to answer?" check that
 * sits between retrieval and answer generation in the self-correcting RAG
 * loop (see SelfCorrectingRetrievalService, which owns the retry loop this
 * feeds).
 *
 * Why it exists: a plain similarity-threshold retrieval (RetrieverService)
 * only tells you "these chunks are topically close enough" — it has no way
 * to know whether they actually cover everything the question needs. A
 * question like "what is the leave policy and can it be carried over?" can
 * retrieve chunks about leave allowances that score well above threshold
 * while never mentioning carry-forward at all. This service asks an LLM to
 * judge sufficiency directly, and — when it isn't sufficient — to propose a
 * follow-up search query aimed at exactly the missing piece, which is what
 * lets the retry loop actually improve on a second attempt rather than
 * blindly re-running the same search.
 *
 * Deliberately fails open: a malformed/unparseable evaluator response is
 * treated as "sufficient" rather than blocking the answer — an evaluator
 * hiccup should degrade to the pre-self-correction behavior (answer from
 * what was retrieved), never leave the user with no answer at all.
 *
 * Deliberately lenient by design, not just on failure: the evaluator's bar
 * for "sufficient" is calibrated to roughly match what the FINAL answer LLM
 * itself is willing to attempt, not a stricter, more literal standard. An
 * evaluator that's pickier than the model actually answering the question
 * just blocks answers the model would have handled fine — that was an
 * observed failure mode on short conversational follow-ups ("how do I
 * request it?") against a single-chunk document: the evaluator kept judging
 * the one available chunk insufficient across every retry (there was no
 * other chunk to find), so the loop gave up and returned NOT_FOUND even
 * though the answer LLM would have synthesized a reasonable answer from
 * that same chunk.
 */
@Injectable()
export class ContextEvaluatorService {
  private readonly logger = new Logger(ContextEvaluatorService.name);
  private readonly model: string;

  constructor(
    private readonly promptService: PromptService,
    private readonly configService: ConfigService,
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI,
  ) {
    this.model = this.configService.get<string>('openai.chatModel', { infer: true }) ?? 'gpt-4o-mini';
  }

  async evaluate(question: string, chunks: RetrievedChunk[]): Promise<ContextEvaluation> {
    if (chunks.length === 0) {
      return { sufficient: false, reason: 'No chunks were retrieved.', refinedQuery: question };
    }

    const context = this.promptService.buildContext(chunks);
    const userPrompt = `Question: ${question}\n\nRetrieved context:\n\n${context}\n\nEvaluate:`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        messages: [
          { role: 'system', content: EVALUATOR_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });

      const raw = response.choices[0]?.message?.content?.trim();
      if (!raw) {
        this.logger.warn('Evaluator returned an empty response — treating context as sufficient');
        return { sufficient: true, reason: 'Evaluator returned no response; defaulting to sufficient.' };
      }

      return this.parseEvaluation(raw);
    } catch (error) {
      this.logger.warn(`Context evaluation failed, treating context as sufficient: ${error instanceof Error ? error.message : error}`);
      return { sufficient: true, reason: 'Evaluator call failed; defaulting to sufficient.' };
    }
  }

  private parseEvaluation(raw: string): ContextEvaluation {
    // Models occasionally wrap JSON in a markdown code fence despite
    // instructions not to — strip it defensively rather than failing.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (typeof parsed !== 'object' || parsed === null || !('sufficient' in parsed)) {
        throw new Error('missing "sufficient" field');
      }
      const obj = parsed as Record<string, unknown>;
      return {
        sufficient: Boolean(obj.sufficient),
        reason: typeof obj.reason === 'string' ? obj.reason : '',
        refinedQuery: typeof obj.refinedQuery === 'string' && obj.refinedQuery.trim() ? obj.refinedQuery.trim() : undefined,
      };
    } catch (error) {
      this.logger.warn(
        `Could not parse evaluator response as JSON, treating context as sufficient: ${error instanceof Error ? error.message : error}`,
      );
      return { sufficient: true, reason: 'Evaluator response was not valid JSON; defaulting to sufficient.' };
    }
  }
}
