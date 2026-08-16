import { useEffect, useRef, useState } from 'react';
import { useChat } from '../hooks/useChat';
import { extractErrorMessage } from '../api/client';
import { MessageBubble, type ChatMessage } from './MessageBubble';

interface ChatPanelProps {
  documentId: string;
  documentReady: boolean;
}

export function ChatPanel({ documentId, documentReady }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const { mutate, isPending } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPending]);

  const handleSend = () => {
    const question = input.trim();
    if (!question || isPending) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: question };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    mutate(
      { documentId, question },
      {
        onSuccess: (data) => {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: 'assistant', content: data.answer, sources: data.sources },
          ]);
        },
        onError: (error) => {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: 'error', content: extractErrorMessage(error) },
          ]);
        },
      },
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2">
            <span className="text-3xl">💬</span>
            <p>{documentReady ? 'Ask a question about your document to get started.' : 'Upload a PDF to start chatting.'}</p>
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" />
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            disabled={!documentReady}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            placeholder={documentReady ? 'Ask a question...' : 'Waiting for document to finish processing...'}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!documentReady || !input.trim() || isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-indigo-700"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
