import { RetrievedChunk } from './retrieved-chunk.interface';

export interface SelfCorrectingRetrievalResult {
  chunks: RetrievedChunk[];
  /** Whether the evaluator judged the final attempt's chunks sufficient. */
  sufficient: boolean;
  /** The evaluator's reason for its last verdict — useful for logging/debugging. */
  reason: string;
  /** The search query actually used on the final attempt (may differ from the input if refined). */
  finalQuery: string;
  /** How many retrieve+evaluate cycles ran (1 = answered on the first try). */
  attempts: number;
}
