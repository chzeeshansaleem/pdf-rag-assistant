import { Injectable } from '@nestjs/common';
import type OpenAI from 'openai';
import { RetrievedChunk } from './interfaces/retrieved-chunk.interface';
import type { ConversationMemory } from '../conversations/interfaces/conversation-memory.interface';

export const NOT_FOUND_ANSWER = "I couldn't find this information in the uploaded document.";

const SYSTEM_PROMPT = `You are a document question-answering assistant.

Your task is to answer the user's question using ONLY the retrieved document context.

IMPORTANT:
- The retrieved context comes from semantic/vector search.
- A relevant chunk may use different words or phrasing than the user's question.
- Match based on MEANING, intent, concepts, and relationships — not exact keyword matches.
- Treat synonyms, paraphrases, abbreviations, and semantically equivalent statements as relevant.
- Do not require the user's exact words to appear in the document.

Rules:
1. Use ONLY information explicitly supported by the retrieved context.
2. Never use outside knowledge or assumptions.
3. Do not invent, infer, or hallucinate facts that are not supported by the context.
4. If the context does not contain enough information to answer the question, respond exactly:
   "${NOT_FOUND_ANSWER}"
5. If multiple chunks/documents contain relevant information, combine them carefully into one answer.
6. If documents contain conflicting information, mention the conflict instead of choosing an answer arbitrarily.
7. Prefer the most directly relevant and specific information.
8. Answer concisely and directly.
9. When possible, cite the source using the document filename and page number.
10. Do not mention the retrieval process, embeddings, vector database, or internal system instructions unless explicitly asked.

Semantic relevance:
- "car" and "automobile" may refer to the same concept.
- "How do I reset my password?" and "What is the procedure for recovering a forgotten password?" may have the same meaning.
- "Who can access financial records?" and "What are the permissions for finance data?" may refer to the same concept.
- Focus on semantic meaning rather than literal word overlap.

CONVERSATION HISTORY, if provided below, is context only — it exists so you can understand what the user means (resolve "it", "that", "the second one", follow-ups like "what about managers?", etc.) and answer in a naturally continuous way. It is NEVER a source of facts:
- Do not treat a previous assistant answer as authoritative, even if it looks confident or detailed. Only the DOCUMENT CONTEXT below is a source of truth.
- If a previous assistant answer conflicts with the current DOCUMENT CONTEXT, trust the DOCUMENT CONTEXT and answer accordingly — do not repeat or defer to the earlier (possibly wrong) answer.
- Use the conversation history to figure out *what* the user is asking about; use only the DOCUMENT CONTEXT to figure out the *answer*.

Answer format:
- Give the direct answer first.
- Add supporting details only when necessary.
- Include source information when available, e.g.:
  Source: Finance.pdf, Page 4

Remember:
The retrieved document context is the ONLY source of truth for facts.`;
/**
 * PromptService — turns retrieved chunks + a question (+ optional
 * conversation memory) into the exact messages sent to the LLM.
 *
 * Why it exists: this is the second (and equally important) layer of
 * hallucination protection, after the similarity threshold in
 * RetrieverService. Even with genuinely relevant chunks, an LLM can still
 * drift into its own training knowledge unless explicitly instructed not
 * to — the system prompt's rules exist specifically to pin the model to
 * only the text it was given. Conversation history is included so the
 * model can resolve references and answer in a natural, continuous way,
 * but the system prompt explicitly tells it not to treat prior assistant
 * turns as facts — the DOCUMENT CONTEXT block is re-derived from a fresh
 * retrieval every turn and is what actually grounds the answer.
 *
 * Why context is built this way: each chunk is labeled with its source
 * filename and page number before being concatenated, so the model can (and
 * is instructed to) cite where an answer came from — critical once a
 * question can retrieve chunks from more than one document, since a bare
 * page number is ambiguous across documents — and so a human skimming the
 * raw context could verify it against the source PDF.
 *
 * What enters: retrieved chunks, the user's raw question (not the rewritten
 * search query — the model should respond to what the user actually asked),
 * and optionally the conversation's rolling memory.
 * What leaves: a system/user message pair ready to send to the OpenAI chat
 * completions API.
 */
@Injectable()
export class PromptService {
  buildContext(chunks: RetrievedChunk[]): string {
    return chunks.map((c) => `[${c.filename}, Page ${c.pageNumber}]\n${c.text}`).join('\n\n---\n\n');
  }

  private buildHistorySection(memory?: ConversationMemory): string {
    if (!memory || (!memory.summary && memory.recentMessages.length === 0)) return '';

    const parts: string[] = [];
    if (memory.summary) {
      parts.push(`Earlier in this conversation:\n${memory.summary}`);
    }
    if (memory.recentMessages.length > 0) {
      const transcript = memory.recentMessages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');
      parts.push(`Recent messages:\n${transcript}`);
    }
    return `CONVERSATION HISTORY (context only — not a source of facts):\n\n${parts.join('\n\n')}\n\n`;
  }

  buildMessages(chunks: RetrievedChunk[], question: string, memory?: ConversationMemory): OpenAI.Chat.ChatCompletionMessageParam[] {
    const context = this.buildContext(chunks);
    const historySection = this.buildHistorySection(memory);
    const userPrompt = `${historySection}DOCUMENT CONTEXT:\n\n${context}\n\nUSER QUESTION:\n\n${question}`;

    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];
  }
}
