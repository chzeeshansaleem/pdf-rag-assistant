import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageCircle, SendHorizontal, Bot } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useDocuments } from '../hooks/useDocuments';
import { extractErrorMessage } from '../api/client';
import { MessageBubble, type ChatMessage } from './MessageBubble';
import { ScopeSelector } from './chat/ScopeSelector';
import type { AskQuestionScope } from '../types/api';

interface ChatPanelProps {
  conversationId: string;
}

export function ChatPanel({ conversationId }: ChatPanelProps) {
  const { data: conversation, isLoading } = useConversationMessages(conversationId);
  const { data: documents = [] } = useDocuments();
  const [input, setInput] = useState('');
  const [scope, setScope] = useState<AskQuestionScope>({});
  const { mutate, isPending } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const MAX_TEXTAREA_HEIGHT = 160;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  const persistedMessages: ChatMessage[] =
    conversation?.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources,
    })) ?? [];

  const [pendingError, setPendingError] = useState<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [persistedMessages.length, isPending]);

  const handleSend = () => {
    const question = input.trim();
    if (!question || isPending) return;

    setInput('');
    setPendingError(null);

    mutate(
      { conversationId, question, scope },
      {
        onError: (error) => setPendingError(extractErrorMessage(error)),
      },
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-slate-400" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-slate-800">Chat</h2>
        </div>
        <ScopeSelector documents={documents} scope={scope} onChange={setScope} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-4">
        {isLoading ? (
          <p className="text-sm text-slate-400">Loading conversation…</p>
        ) : persistedMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
              <Bot className="h-6 w-6 text-white" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-600">Ask about your documents</p>
              <p className="mt-0.5 text-xs text-slate-400">Answers are grounded in what you've uploaded, with citations.</p>
            </div>
          </div>
        ) : (
          persistedMessages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {isPending && (
          <div className="flex items-start gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600">
              <Bot className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 flex items-center gap-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce" />
            </div>
          </div>
        )}
        {pendingError && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-red-200 bg-red-50 px-4 py-2.5 text-red-700 text-sm">
              {pendingError}
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="shrink-0 border-t border-slate-100 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/20">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask a question… (Shift+Enter for a new line)"
            className="flex-1 resize-none bg-transparent px-2.5 py-1.5 text-sm leading-normal text-slate-800 placeholder:text-slate-400 focus:outline-none"
            style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isPending}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-30 disabled:hover:bg-indigo-600"
          >
            <SendHorizontal className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}
