import { Injectable } from '@nestjs/common';

type ChitchatCategory = 'greeting' | 'wellbeing' | 'thanks' | 'farewell' | 'capability' | 'acknowledgement';

// A leading "hello, "/"hi "/"hey, " is common before the real ask ("hello,
// how can you help me?") — strip it before matching so the rest of the
// pattern set doesn't have to duplicate every combination.
const LEADING_GREETING = /^(hi|hello|hey+|hiya|yo|greetings)[\s!.,]+/i;

// Trailing whitespace before a "?" is common ("how are you ?") — every
// pattern ends with this same tail rather than a bare `\??`.
const TAIL = '\\s*\\??[\\s!.,]*$';

/**
 * Patterns are anchored to the FULL (trimmed, greeting-prefix-stripped)
 * message, not a substring match — "How are leave days calculated?" must
 * never match "how are you", and "Who are the approvers?" must never match
 * "who are you". Only a short message that IS one of these phrases (plus
 * a leading "hello"/trailing punctuation) counts.
 */
const PATTERNS: Array<{ category: ChitchatCategory; regex: RegExp }> = [
  { category: 'greeting', regex: new RegExp(`^(hi|hello|hey+|hiya|yo|greetings)${TAIL}`, 'i') },
  { category: 'greeting', regex: new RegExp(`^good\\s*(morning|afternoon|evening|day)${TAIL}`, 'i') },
  { category: 'wellbeing', regex: new RegExp(`^how'?(re)?\\s*(are\\s*you|is\\s*it\\s*going|are\\s*ya|r\\s*u|you)${TAIL}`, 'i') },
  { category: 'wellbeing', regex: new RegExp(`^what'?s\\s*up${TAIL}`, 'i') },
  { category: 'thanks', regex: new RegExp(`^(thanks|thank\\s*you|thx|ty)(\\s*(so much|a lot|very much))?${TAIL}`, 'i') },
  { category: 'farewell', regex: new RegExp(`^(bye|goodbye|see\\s*you(\\s*later)?|see\\s*ya|farewell)${TAIL}`, 'i') },
  { category: 'capability', regex: new RegExp(`^who\\s*are\\s*you${TAIL}`, 'i') },
  { category: 'capability', regex: new RegExp(`^what\\s*(can|do)\\s*you\\s*do${TAIL}`, 'i') },
  { category: 'capability', regex: new RegExp(`^how\\s*(can|may|could)\\s*(you|i)\\s*help(\\s*(you|me))?${TAIL}`, 'i') },
  { category: 'acknowledgement', regex: new RegExp(`^(ok|okay|cool|nice|great|got it|sounds good|alright)${TAIL}`, 'i') },
];

const RESPONSES: Record<ChitchatCategory, string> = {
  greeting: "Hello! I'm DocuMind AI. Ask me anything about your uploaded documents and I'll find the answer for you, with citations.",
  wellbeing: "I'm doing well, thanks for asking! I'm here to help answer questions about your documents — what would you like to know?",
  thanks: "You're welcome! Let me know if you have any other questions about your documents.",
  farewell: 'Goodbye! Feel free to come back anytime you have questions about your documents.',
  capability:
    "I'm a document Q&A assistant — upload PDFs and I'll answer questions grounded in their content, citing the source filename and page. What would you like to know?",
  acknowledgement: "Great! Let me know if there's anything else you'd like to know about your documents.",
};

// A message that's a bare greeting PLUS something else ("hello, how can you
// help me?") should read as the something-else category, not a plain
// greeting — capability/wellbeing/etc. are checked first via pattern order.
const GREETING_ONLY_CATEGORY: ChitchatCategory = 'greeting';

// Longer messages are never chitchat, even if they happen to start with a
// greeting word — keeps this from misfiring on real questions.
const MAX_WORDS = 10;

/**
 * ChitchatService — a fast, free, deterministic pre-filter that keeps
 * social messages ("hello", "how are you?", "what can you do?", "hello,
 * how can you help me?") from running the full RAG pipeline.
 *
 * Why it exists: without this, a greeting embeds, searches Qdrant, finds
 * nothing relevant (correctly — "hello" isn't in any document), and
 * returns the canned NOT_FOUND_ANSWER — technically correct but a poor,
 * robotic user experience for messages that were never document questions
 * in the first place. This runs BEFORE the query rewriter and retrieval,
 * so a chitchat message costs nothing (no embedding call, no Qdrant
 * search, no chat-completion call) and never risks the hallucination-guard
 * NOT_FOUND response leaking into an otherwise normal conversation.
 *
 * Deliberately not LLM-based: detection needs to be instant and free, and
 * responses are fixed per category rather than generated, matching the
 * existing precedent of NOT_FOUND_ANSWER being a canned string for a class
 * of non-document-answerable message.
 */
@Injectable()
export class ChitchatService {
  /** Returns the canned reply if `question` is chitchat, otherwise null. */
  detect(question: string): string | null {
    const trimmed = question.trim();
    if (!trimmed || trimmed.split(/\s+/).length > MAX_WORDS) return null;

    // Try the message as-is first (so a bare "hello" still hits the
    // greeting pattern), then with a leading greeting word stripped (so
    // "hello, how can you help me?" is classified by what follows it).
    const withoutGreeting = trimmed.replace(LEADING_GREETING, '');
    const candidates = withoutGreeting === trimmed ? [trimmed] : [withoutGreeting, trimmed];

    for (const candidate of candidates) {
      for (const { category, regex } of PATTERNS) {
        if (category === GREETING_ONLY_CATEGORY && candidate !== trimmed) continue; // don't re-match "greeting" on the stripped remainder
        if (regex.test(candidate)) return RESPONSES[category];
      }
    }
    return null;
  }
}
