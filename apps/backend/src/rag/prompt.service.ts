import { Injectable } from '@nestjs/common';
import type OpenAI from 'openai';
import { RetrievedChunk } from './retriever.service';

export const NOT_FOUND_ANSWER = "I couldn't find this information in the uploaded document.";

const SYSTEM_PROMPT = `You are a document question-answering assistant.

Answer the user's question using ONLY the provided document context.

Rules:
1. Do not use outside knowledge.
2. Do not invent facts.
3. If the answer cannot be found in the context, clearly say: "${NOT_FOUND_ANSWER}"
4. Prefer concise and direct answers.
5. When possible, mention the page number where the information was found.`;

/**
 * PromptService — turns retrieved chunks + a question into the exact
 * messages sent to the LLM.
 *
 * Why it exists: this is the second (and equally important) layer of
 * hallucination protection, after the similarity threshold in
 * RetrieverService. Even with genuinely relevant chunks, an LLM can still
 * drift into its own training knowledge unless explicitly instructed not
 * to — the system prompt's rules exist specifically to pin the model to
 * only the text it was given.
 *
 * Why context is built this way: each chunk is labeled with its page number
 * before being concatenated, so the model can (and is instructed to) cite
 * where an answer came from, and so a human skimming the raw context could
 * verify it against the source PDF.
 *
 * What enters: retrieved chunks and the user's question.
 * What leaves: a system/user message pair ready to send to the OpenAI chat
 * completions API.
 */
@Injectable()
export class PromptService {
  buildContext(chunks: RetrievedChunk[]): string {
    return chunks.map((c) => `[Page ${c.pageNumber}]\n${c.text}`).join('\n\n---\n\n');
  }

  buildMessages(chunks: RetrievedChunk[], question: string): OpenAI.Chat.ChatCompletionMessageParam[] {
    const context = this.buildContext(chunks);
    const userPrompt = `DOCUMENT CONTEXT:\n\n${context}\n\nUSER QUESTION:\n\n${question}`;

    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];
  }
}
