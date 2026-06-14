import { useState, useCallback, useEffect } from "react";
import type { ChatMessage, ChatSession } from "../types/chat";
import {
  deleteMemorySession,
  listMemoryMessages,
  listMemorySessions,
  upsertMemorySessionMetadata,
} from "../lib/memory";

const EMPTY_MESSAGES: ChatMessage[] = [];

function generateTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "新しい検索";
  return first.content.length > 30
    ? first.content.slice(0, 30) + "..."
    : first.content;
}

function sessionFromMessages(sessionId: string, messages: ChatMessage[]): ChatSession {
  const lastMsg = messages[messages.length - 1];
  return {
    id: sessionId,
    title: generateTitle(messages),
    lastMessage: lastMsg?.content?.slice(0, 50) ?? "",
    timestamp: lastMsg?.timestamp ?? Date.now(),
  };
}

export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messageCache, setMessageCache] = useState<Record<string, ChatMessage[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  const refreshSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const remoteSessions = await listMemorySessions();
      setSessions((prev) => {
        const remoteIds = new Set(remoteSessions.map((session) => session.id));
        const optimisticSessions = prev.filter((session) => !remoteIds.has(session.id));
        return [
          ...remoteSessions,
          ...optimisticSessions,
        ].sort((a, b) => b.timestamp - a.timestamp);
      });
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    refreshSessions().catch(() => {
      setSessions([]);
      setIsLoadingSessions(false);
    });
  }, [refreshSessions]);

  const createSession = useCallback(() => {
    const id = crypto.randomUUID();
    setActiveId(id);
    setMessageCache((prev) => ({ ...prev, [id]: EMPTY_MESSAGES }));
    return id;
  }, []);

  const updateSession = useCallback(
    (sessionId: string, messages: ChatMessage[]) => {
      setMessageCache((prev) => ({ ...prev, [sessionId]: messages }));
      setSessions((prev) => {
        const session = sessionFromMessages(sessionId, messages);
        const next = [
          session,
          ...prev.filter((item) => item.id !== sessionId),
        ];
        return next.sort((a, b) => b.timestamp - a.timestamp);
      });
      setActiveId(sessionId);
      void upsertMemorySessionMetadata(sessionId, messages).then((remoteSession) => {
        if (!remoteSession) return;
        setSessions((prev) => [
          remoteSession,
          ...prev.filter((item) => item.id !== sessionId),
        ].sort((a, b) => b.timestamp - a.timestamp));
      }).catch(() => {});
    },
    [],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await deleteMemorySession(id);
      setSessions((prev) => prev.filter((session) => session.id !== id));
      setMessageCache((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeId === id) setActiveId(null);
    },
    [activeId],
  );

  const selectSession = useCallback(
    async (id: string) => {
      let messages = messageCache[id];
      if (!messageCache[id]) {
        messages = await listMemoryMessages(id);
        setMessageCache((prev) => ({ ...prev, [id]: messages }));
      }
      if (messages?.length) {
        setSessions((prev) => {
          const session = sessionFromMessages(id, messages);
          return prev
            .map((item) => (item.id === id ? session : item))
            .sort((a, b) => b.timestamp - a.timestamp);
        });
      }
      setActiveId(id);
    },
    [messageCache],
  );

  return {
    sessions,
    activeId,
    activeMessages: activeId ? messageCache[activeId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
    isLoadingSessions,
    createSession,
    updateSession,
    deleteSession,
    selectSession,
    refreshSessions,
  };
}
