import { Bot, AlertTriangle, User } from 'lucide-react';
import { SourcesList } from './SourcesList';
import type { ChatSource } from '../types/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  sources?: ChatSource[];
}

function Avatar({ role }: { role: ChatMessage['role'] }) {
  if (role === 'user') {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
        <User className="h-3.5 w-3.5" strokeWidth={2.25} />
      </div>
    );
  }
  if (role === 'error') {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.25} />
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
      <Bot className="h-3.5 w-3.5" strokeWidth={2.25} />
    </div>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex items-start justify-end gap-2.5">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-[13.5px] leading-relaxed text-white shadow-sm">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        <Avatar role="user" />
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="flex items-start gap-2.5">
        <Avatar role="error" />
        <div className="max-w-[75%] rounded-2xl rounded-tl-sm border border-red-200 bg-red-50 px-4 py-2.5 text-[13.5px] text-red-700">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <Avatar role="assistant" />
      <div className="max-w-[75%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-800">{message.content}</p>
        {message.sources && message.sources.length > 0 && <SourcesList sources={message.sources} />}
      </div>
    </div>
  );
}
