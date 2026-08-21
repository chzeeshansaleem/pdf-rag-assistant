import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutGrid, MessageSquare, Plus, Sparkles, MessageCircle } from 'lucide-react';
import { useConversations, useCreateConversation } from '../../hooks/useConversations';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

function relativeDay(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Sidebar() {
  const { data: conversations = [] } = useConversations();
  const createConversation = useCreateConversation();
  const navigate = useNavigate();
  const location = useLocation();
  const onChatTab = location.pathname.startsWith('/chat');

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
          <Sparkles className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-slate-900 tracking-tight">DocuMind AI</h1>
          <p className="text-[11px] text-slate-400 leading-none">Document intelligence</p>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 pb-2">
        <NavLink to="/dashboard" className={linkClass}>
          <LayoutGrid className="h-4 w-4" strokeWidth={2} />
          Dashboard
        </NavLink>
        <NavLink to="/chat" end className={linkClass}>
          <MessageSquare className="h-4 w-4" strokeWidth={2} />
          Chat
        </NavLink>
      </nav>

      {onChatTab && (
        <div className="flex-1 min-h-0 flex flex-col border-t border-slate-100 px-3 pt-3 pb-3">
          <button
            type="button"
            onClick={() => {
              createConversation.mutate(undefined, {
                onSuccess: (conversation) => navigate(`/chat/${conversation.id}`),
              });
            }}
            disabled={createConversation.isPending}
            className="mb-3 flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            New chat
          </button>

          <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Recent</p>

          {conversations.length === 0 ? (
            <p className="px-1 pt-2 text-xs text-slate-400">Your conversations will show up here.</p>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 -mx-1 px-1">
              {conversations.map((c) => (
                <NavLink
                  key={c.id}
                  to={`/chat/${c.id}`}
                  className={({ isActive }) =>
                    `group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                      isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`
                  }
                  title={c.title ?? 'Untitled conversation'}
                >
                  <MessageCircle className="h-3.5 w-3.5 shrink-0 opacity-50 group-hover:opacity-70" strokeWidth={2} />
                  <span className="truncate flex-1">{c.title ?? 'Untitled conversation'}</span>
                  <span className="shrink-0 text-[10px] text-slate-300">{relativeDay(c.updatedAt)}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
