/**
 * The LLM evaluator's verdict on whether retrieved chunks are enough to
 * answer a question. `refinedQuery` is the evaluator's own suggestion for
 * what to search next when it isn't — phrased around what's MISSING, not a
 * rephrasing of the original question — so it doubles as this pipeline's
 * "query refinement" step without a second LLM round-trip.
 */
export interface ContextEvaluation {
  sufficient: boolean;
  reason: string;
  refinedQuery?: string;
}
