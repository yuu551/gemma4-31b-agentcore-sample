import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  FileText,
  LogOut,
  Moon,
  PanelLeft,
  Search,
  Sun,
  UserRound,
} from "lucide-react";
import { useChat } from "./hooks/useChat";
import { useSessions } from "./hooks/useSessions";
import { useTheme } from "./hooks/useTheme";
import { ChatMessage } from "./components/ChatMessage";
import { ChatInput } from "./components/ChatInput";
import { Sidebar } from "./components/Sidebar";
import { CATEGORIES, type Category } from "./types/chat";

interface HeaderUser {
  name?: string;
  email?: string;
}

function TopBar({
  theme,
  onToggleTheme,
  user,
  onSignOut,
  isSidebarOpen,
  onOpenSidebar,
}: {
  theme: string;
  onToggleTheme: () => void;
  user?: HeaderUser | null;
  onSignOut?: () => void;
  isSidebarOpen: boolean;
  onOpenSidebar: () => void;
}) {
  const displayName = user?.name ?? user?.email;

  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-surface-600/60 bg-surface-900/72 px-4 backdrop-blur-xl sm:px-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 truncate text-base font-semibold text-text-primary font-(family-name:--font-heading)">
          {!isSidebarOpen && (
            <button
              onClick={onOpenSidebar}
              className="mr-1 hidden h-9 w-9 place-items-center rounded-xl border border-surface-600/70 bg-surface-800 text-text-muted shadow-[var(--shadow-subtle)] transition hover:text-text-primary md:grid"
              aria-label="サイドバーを開く"
              title="サイドバーを開く"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <Search className="h-3.5 w-3.5 text-aws-ember" />
          ナレッジ検索
        </h1>
      </div>

      <div className="flex items-center gap-2">
        {displayName && (
          <div className="hidden max-w-[280px] items-center gap-2 rounded-xl border border-surface-600/70 bg-surface-800 px-3 py-2 text-sm text-text-secondary shadow-[var(--shadow-subtle)] sm:flex">
            <UserRound className="h-4 w-4 shrink-0 text-aws-ember" />
            <span className="truncate">{displayName}</span>
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="ml-1 shrink-0 rounded-lg p-1 text-text-muted transition hover:bg-surface-700 hover:text-text-primary"
                title="サインアウト"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        <button
          onClick={onToggleTheme}
          className="grid h-10 w-10 place-items-center rounded-xl border border-surface-600/70 bg-surface-800 text-text-muted shadow-[var(--shadow-subtle)] transition duration-200 hover:-translate-y-0.5 hover:text-text-primary"
          aria-label="テーマを切り替え"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}

function EmptyState({
  selectedCategory,
  onCategorySelect,
}: {
  selectedCategory: Category | null;
  onCategorySelect: (category: Category) => void;
}) {
  return (
    <section className="mx-auto flex min-h-[calc(100svh-220px)] max-w-5xl flex-col justify-center py-12">
      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-surface-600/70 bg-surface-800/80 px-3 py-1.5 text-xs font-medium text-text-secondary shadow-[var(--shadow-subtle)]">
            <FileText className="h-3.5 w-3.5 text-aws-ember" />
            規程・手順書・ポリシー
          </div>
          <h2 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.08] text-text-primary font-(family-name:--font-heading) sm:text-5xl">
            必要な文書を、
            <br />
            <span className="whitespace-nowrap">会話で探す。</span>
          </h2>
          <p className="mt-5 max-w-xl text-base leading-8 text-text-secondary">
            質問に対して、関連する文書を探しながら回答します。必要なら下のカテゴリで対象を絞り込めます。
          </p>
        </div>

        <div className="rounded-[2rem] border border-surface-600/70 bg-surface-800/74 p-3 shadow-[var(--shadow-elevated)] backdrop-blur">
          <div className="rounded-[1.5rem] border border-surface-600/60 bg-surface-900/86 p-4">
            <div className="mb-4">
              <div className="text-sm font-semibold text-text-primary">検索対象</div>
              <div className="mt-1 text-xs text-text-muted">
                よく使う文書群から絞り込めます。
              </div>
            </div>

            <div className="grid gap-2">
              {CATEGORIES.map((category) => (
                <button
                  key={category.value}
                  onClick={() => onCategorySelect(category.value)}
                  className={`group flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm shadow-[var(--shadow-subtle)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] ${
                    selectedCategory === category.value
                      ? "border-aws-ember/45 bg-accent-soft text-text-primary"
                      : "border-surface-600/70 bg-surface-800 text-text-secondary hover:border-aws-ember/40 hover:text-text-primary"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-text-primary">{category.label}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">{category.description}</span>
                  </span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full transition group-hover:bg-aws-ember group-hover:shadow-[0_0_18px_var(--accent)] ${
                      selectedCategory === category.value ? "bg-aws-ember shadow-[0_0_18px_var(--accent)]" : "bg-surface-500"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryScope({ selectedCategory }: { selectedCategory: Category | null }) {
  const selected = CATEGORIES.find((category) => category.value === selectedCategory);

  if (!selected) return null;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 rounded-2xl border border-aws-ember/25 bg-accent-soft px-4 py-3 text-sm text-text-primary shadow-[var(--shadow-subtle)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-aws-ember">検索対象</span>
          <span className="font-semibold">{selected.label}</span>
          <span className="text-text-secondary">{selected.description}</span>
        </div>
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="fade-up flex justify-start">
      <div className="ml-0 rounded-2xl border border-surface-600/70 bg-surface-800/88 px-4 py-3 shadow-[var(--shadow-card)] sm:ml-14">
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <div className="flex gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-aws-ember animate-bounce [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-aws-ember animate-bounce [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-aws-ember animate-bounce [animation-delay:300ms]" />
          </div>
          考え中...
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const {
    sessions,
    activeMessages,
    createSession,
    updateSession,
    deleteSession,
    selectSession,
  } = useSessions();

  const { theme, toggle: toggleTheme } = useTheme();
  const { user, signOut } = useAuthenticator();
  const headerUser = useMemo(() => ({
    email: user?.signInDetails?.loginId,
  }), [user]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleMessagesChange = useCallback(
    (messages: typeof activeMessages, targetSessionId?: string | null) => {
      const sessionId = targetSessionId ?? currentSessionId;
      if (sessionId && messages.length > 0) {
        updateSession(sessionId, messages);
      }
    },
    [currentSessionId, updateSession],
  );

  const { messages, isLoading, sendMessage } = useChat({
    initialMessages: activeMessages,
    sessionId: currentSessionId,
    onMessagesChange: handleMessagesChange,
  });
  const hasStreamingAssistant = messages.some(
    (message) => message.role === "assistant" && message.isStreaming,
  );

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleNewSession = () => {
    const id = createSession();
    setCurrentSessionId(id);
  };

  const handleSelectSession = (id: string) => {
    selectSession(id);
    setCurrentSessionId(id);
  };

  const handleSend = (content: string) => {
    const sessionId = currentSessionId ?? createSession();
    if (!currentSessionId) setCurrentSessionId(sessionId);
    sendMessage(content, { category: selectedCategory, sessionId });
  };

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-surface-950 text-text-primary">
      {isSidebarOpen && (
        <Sidebar
          sessions={sessions}
          activeSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={deleteSession}
          onClose={() => setIsSidebarOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          theme={theme}
          onToggleTheme={toggleTheme}
          user={headerUser}
          onSignOut={signOut}
          isSidebarOpen={isSidebarOpen}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {messages.length > 0 && (
            <CategoryScope selectedCategory={selectedCategory} />
          )}
          <div className="mx-auto max-w-4xl space-y-5">
            {messages.length === 0 && (
              <EmptyState
                selectedCategory={selectedCategory}
                onCategorySelect={setSelectedCategory}
              />
            )}

            {messages.map((msg, index) => {
              const sourceQuestion = [...messages]
                .slice(0, index)
                .reverse()
                .find((item) => item.role === "user");

              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  sessionId={currentSessionId}
                  question={sourceQuestion?.content}
                  feedbackCategory={sourceQuestion?.category ?? null}
                />
              );
            })}

            {isLoading && !hasStreamingAssistant && <ThinkingIndicator />}

            <div ref={messagesEndRef} />
          </div>
        </main>

        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />
      </div>
    </div>
  );
}
