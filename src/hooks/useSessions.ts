import { useState, useCallback } from "react";
import type { ChatMessage, ChatSession } from "../types/chat";

const STORAGE_KEY = "agentic-rag-sessions";
const EMPTY_MESSAGES: ChatMessage[] = [];

interface SessionData {
  session: ChatSession;
  messages: ChatMessage[];
}

function loadSessions(): SessionData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(data: SessionData[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function generateTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "新しい検索";
  return first.content.length > 30
    ? first.content.slice(0, 30) + "..."
    : first.content;
}

export function useSessions() {
  const [sessions, setSessions] = useState<SessionData[]>(loadSessions);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.session.id === activeId) ?? null;

  const createSession = useCallback(() => {
    const id = crypto.randomUUID();
    setActiveId(id);
    return id;
  }, []);

  const updateSession = useCallback(
    (sessionId: string, messages: ChatMessage[]) => {
      setSessions((prev) => {
        const existing = prev.find((s) => s.session.id === sessionId);
        const lastMsg = messages[messages.length - 1];
        const session: ChatSession = {
          id: sessionId,
          title: generateTitle(messages),
          lastMessage: lastMsg?.content?.slice(0, 50) ?? "",
          timestamp: lastMsg?.timestamp ?? Date.now(),
        };
        const data: SessionData = { session, messages };

        const next = existing
          ? prev.map((s) => (s.session.id === sessionId ? data : s))
          : [data, ...prev];

        saveSessions(next);
        return next;
      });
    },
    [],
  );

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.session.id !== id);
        saveSessions(next);
        return next;
      });
      if (activeId === id) setActiveId(null);
    },
    [activeId],
  );

  const selectSession = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  return {
    sessions: sessions.map((s) => s.session),
    activeId,
    activeMessages: activeSession?.messages ?? EMPTY_MESSAGES,
    createSession,
    updateSession,
    deleteSession,
    selectSession,
  };
}
