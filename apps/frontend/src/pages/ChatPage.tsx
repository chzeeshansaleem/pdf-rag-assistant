import { useNavigate, useParams } from 'react-router-dom';
import { MessageCircle, Plus } from 'lucide-react';
import { ChatPanel } from '../components/ChatPanel';
import { useCreateConversation } from '../hooks/useConversations';

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const createConversation = useCreateConversation();

  if (!conversationId) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <MessageCircle className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-600">No conversation selected</p>
          <p className="mt-0.5 text-xs text-slate-400">Start a new chat to ask about your documents.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            createConversation.mutate(undefined, {
              onSuccess: (conversation) => navigate(`/chat/${conversation.id}`),
            });
          }}
          disabled={createConversation.isPending}
          className="mt-1 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" strokeWidth={2.25} />
          New chat
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 p-6">
      <div className="h-full rounded-xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <ChatPanel key={conversationId} conversationId={conversationId} />
      </div>
    </div>
  );
}
