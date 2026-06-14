import { useState } from "react";
import {
  AlertTriangle,
  Archive,
  MessageSquarePlus,
  PanelLeft,
  Trash2,
  X,
} from "lucide-react";
import { AssistantAvatar, BookOpenIcon } from "./icons";
import type { ChatSession } from "../types/chat";

interface Props {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onClose: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onClose,
}: Props) {
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null);

  const confirmDelete = () => {
    if (!sessionToDelete) return;
    onDeleteSession(sessionToDelete.id);
    setSessionToDelete(null);
  };

  return (
    <aside className="hidden h-full w-[292px] shrink-0 flex-col border-r border-surface-600/60 bg-surface-900/86 shadow-[var(--shadow-card)] backdrop-blur md:flex">
      <div className="px-5 pb-5 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <AssistantAvatar className="h-10 w-10" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-primary font-(family-name:--font-heading)">
                ナレッジ検索
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl text-text-muted transition hover:bg-surface-800 hover:text-text-primary"
            aria-label="サイドバーを閉じる"
            title="サイドバーを閉じる"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={onNewSession}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-text-primary px-3.5 py-3 text-sm font-semibold text-surface-900 shadow-[var(--shadow-card)] transition duration-200 hover:-translate-y-0.5 hover:bg-aws-ember hover:text-white"
        >
          <MessageSquarePlus className="h-4 w-4" />
          新しく検索
        </button>
      </div>

      <div className="flex items-center justify-between px-5 pb-2 pt-1 text-[11px] font-semibold tracking-[0.12em] text-text-muted">
        <span>履歴</span>
        <span>{sessions.length}</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {sessions.length === 0 && (
          <div className="mx-2 mt-4 rounded-2xl border border-dashed border-surface-600 px-4 py-8 text-center">
            <Archive className="mx-auto mb-3 h-6 w-6 text-text-muted" />
            <p className="text-xs font-medium text-text-secondary">履歴はまだありません</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
              最初の検索を送るとここに保存されます。
            </p>
          </div>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`group mb-1 flex items-start gap-2 rounded-2xl px-2 py-2 transition duration-200
              ${activeSessionId === session.id
                ? "bg-surface-800 text-text-primary shadow-[var(--shadow-subtle)]"
                : "text-text-secondary hover:bg-surface-800/70 hover:text-text-primary"
              }`}
          >
            <button
              onClick={() => onSelectSession(session.id)}
              className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl px-1.5 py-1 text-left"
            >
              <BookOpenIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-aws-ember" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{session.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                  {formatRelativeTime(session.timestamp)}
                </span>
              </span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSessionToDelete(session);
              }}
              className="mt-1 rounded-lg p-1.5 text-text-muted opacity-0 transition duration-200 hover:bg-surface-700 hover:text-text-primary group-hover:opacity-100"
              aria-label={`${session.title} を削除`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </nav>

      {sessionToDelete && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-surface-950/60 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-session-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-surface-600/70 bg-surface-900 p-4 shadow-[var(--shadow-elevated)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-aws-ember">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h2 id="delete-session-title" className="text-sm font-semibold text-text-primary">
                    履歴を削除しますか
                  </h2>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                    {sessionToDelete.title}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSessionToDelete(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-surface-800 hover:text-text-primary"
                aria-label="削除確認を閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setSessionToDelete(null)}
                className="rounded-xl border border-surface-600/70 bg-surface-800 px-4 py-2 text-sm font-medium text-text-secondary transition hover:text-text-primary"
              >
                キャンセル
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-xl bg-aws-ember px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-subtle)] transition hover:bg-accent-strong"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
