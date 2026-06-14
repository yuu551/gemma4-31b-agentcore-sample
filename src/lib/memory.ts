import { fetchAuthSession } from "aws-amplify/auth";
import outputs from "../../amplify_outputs.json";
import { CATEGORIES, type ChatMessage, type ChatSession, type ToolCall } from "../types/chat";

const customOutputs = outputs.custom as Record<string, string | undefined> | undefined;
const MEMORY_URL = customOutputs?.memory_url ?? "";

async function getIdToken(forceRefresh = false): Promise<string> {
  const session = await fetchAuthSession({ forceRefresh });
  const token = session.tokens?.idToken?.toString();
  if (!token) {
    throw new Error("Cognito ID token is not available");
  }
  return token;
}

function buildUrl(path: string): string {
  return `${MEMORY_URL.replace(/\/$/, "")}${path}`;
}

async function requestMemory(path: string, init: RequestInit = {}, forceRefresh = false): Promise<Response> {
  return fetch(buildUrl(path), {
    ...init,
    headers: {
      Authorization: await getIdToken(forceRefresh),
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function requestWithRefresh(path: string, init: RequestInit = {}): Promise<Response> {
  let response = await requestMemory(path, init);
  if (response.status === 401) {
    response = await requestMemory(path, init, true);
  }
  return response;
}

async function parseJsonResponse<T>(response: Response, fallback: T): Promise<T> {
  if (response.status === 404) return fallback;
  if (!response.ok) {
    let message = `Memory API failed: ${response.status}`;
    try {
      const error = await response.json();
      if (typeof error?.message === "string") message = error.message;
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function parseJsonText(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const text = value.trim();
  if (!text || !["[", "{", "\""].includes(text[0])) return value;

  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function textFromContent(value: unknown): string {
  const parsed = parseJsonText(value);

  if (typeof parsed === "string") return parsed;

  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => textFromContent(item))
      .filter(Boolean)
      .join("\n");
  }

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if ("content" in record) return textFromContent(record.content);
    if ("message" in record) return textFromContent(record.message);
  }

  return "";
}

function toolResultText(value: unknown): string {
  const parsed = parseJsonText(value);

  if (typeof parsed === "string") return parsed;
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => toolResultText(item))
      .filter(Boolean)
      .join("\n");
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if ("content" in record) return toolResultText(record.content);
  }
  return "";
}

function toolCallsFromContent(value: unknown): ToolCall[] {
  const parsed = parseJsonText(value);

  if (Array.isArray(parsed)) {
    const calls: ToolCall[] = [];
    for (const item of parsed) calls.push(...toolCallsFromContent(item));
    return mergeToolResults(calls);
  }

  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;

  if (record.message && typeof record.message === "object" && !Array.isArray(record.message)) {
    return toolCallsFromContent((record.message as Record<string, unknown>).content);
  }

  const calls: (ToolCall & { resultOnly?: boolean })[] = [];
  if (record.toolUse && typeof record.toolUse === "object" && !Array.isArray(record.toolUse)) {
    const toolUse = record.toolUse as Record<string, unknown>;
    if (typeof toolUse.name === "string") {
      calls.push({
        name: toolUse.name,
        input: toolUse.input && typeof toolUse.input === "object" && !Array.isArray(toolUse.input)
          ? toolUse.input as Record<string, unknown>
          : {},
        status: "done",
      });
    }
  }

  if (record.toolResult && typeof record.toolResult === "object" && !Array.isArray(record.toolResult)) {
    const toolResult = record.toolResult as Record<string, unknown>;
    const result = toolResultText(toolResult.content);
    if (result) {
      calls.push({
        name: typeof toolResult.toolUseId === "string" ? toolResult.toolUseId : "tool",
        input: {},
        result: result.slice(0, 1000),
        status: "done",
        resultOnly: true,
      });
    }
  }

  if ("content" in record) calls.push(...toolCallsFromContent(record.content));
  return mergeToolResults(calls);
}

function mergeToolResults(calls: (ToolCall & { resultOnly?: boolean })[]): ToolCall[] {
  const merged: ToolCall[] = [];
  for (const call of calls) {
    if (call.resultOnly) {
      const previous = merged[merged.length - 1];
      if (previous && !previous.result) previous.result = call.result;
      continue;
    }
    const { resultOnly: _resultOnly, ...toolCall } = call;
    merged.push(toolCall);
  }
  return merged;
}

function normalizeContent(content: string): string {
  const parsed = parseJsonText(content);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const message = record.message;
    if (message && typeof message === "object" && !Array.isArray(message)) {
      return textFromContent((message as Record<string, unknown>).content) || content;
    }
    return textFromContent(record.content ?? record.text ?? record) || content;
  }

  return textFromContent(parsed) || content;
}

function normalizeRestoredUserMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "user") return message;

  const categoryPrompt = message.content.match(
    /^検索対象カテゴリ:\s*(.+?)\s*\nカテゴリに該当する文書を優先し、根拠が曖昧な場合はその旨を短く明記してください。\s*\n+\s*質問[:：]\s*([\s\S]+)$/u,
  );
  if (!categoryPrompt) return message;

  const categoryLabel = categoryPrompt[1]?.trim();
  const restoredCategory = CATEGORIES.find(
    (category) => category.label === categoryLabel || category.value === categoryLabel,
  )?.value;
  const restoredQuestion = categoryPrompt[2]?.trim();

  if (!restoredQuestion) return message;

  return {
    ...message,
    content: restoredQuestion,
    category: restoredCategory ?? message.category ?? null,
  };
}

function looksLikeSerializedMessage(value: string): boolean {
  const text = value.trim();
  return (
    text.startsWith("{\"message\"") ||
    text.startsWith("{'message'") ||
    text.startsWith("{\"role\"") ||
    text.includes("\"message\":") ||
    text.includes("\"role\":")
  );
}

function normalizeSessionText(value: string, limit: number): string {
  const text = normalizeContent(value).replace(/\s+/g, " ").trim();
  if (looksLikeSerializedMessage(text)) return "";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  const parsed = parseJsonText(message.content);
  const parsedToolCalls = toolCallsFromContent(parsed);
  const toolCalls = message.toolCalls?.length ? message.toolCalls : parsedToolCalls;

  return normalizeRestoredUserMessage({
    ...message,
    content: normalizeContent(message.content),
    toolCalls: toolCalls.length > 0 ? toolCalls : message.toolCalls,
  });
}

function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  if (!first) return "";
  const title = first.content.replace(/\s+/g, " ").trim();
  return title.length > 30 ? `${title.slice(0, 30)}...` : title;
}

function lastMessageFromMessages(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  const text = last.content.replace(/\s+/g, " ").trim();
  return text.length > 50 ? text.slice(0, 50) : text;
}

function normalizeSession(session: ChatSession): ChatSession {
  const messages = session.messages?.map(normalizeMessage) ?? [];
  const title = (
    titleFromMessages(messages) ||
    normalizeSessionText(session.title, 30) ||
    normalizeSessionText(session.lastMessage, 30) ||
    "履歴"
  );
  const lastMessage = (
    lastMessageFromMessages(messages) ||
    normalizeSessionText(session.lastMessage, 50)
  );
  const timestamp = messages[messages.length - 1]?.timestamp ?? session.timestamp;

  return {
    ...session,
    title,
    lastMessage,
    timestamp,
    messages,
  };
}

export async function listMemorySessions(): Promise<ChatSession[]> {
  if (!MEMORY_URL) return [];

  const response = await requestWithRefresh("/sessions", { method: "GET" });
  const data = await parseJsonResponse<{ sessions?: ChatSession[] }>(response, {});
  return (data.sessions ?? []).map(normalizeSession);
}

export async function upsertMemorySessionMetadata(
  sessionId: string,
  messages: ChatMessage[],
): Promise<ChatSession | null> {
  if (!MEMORY_URL || messages.length === 0) return null;

  const normalizedMessages = messages.map(normalizeMessage);
  const toolCallCount = normalizedMessages.reduce(
    (count, message) => count + (message.toolCalls?.length ?? 0),
    0,
  );
  const lastMessage = normalizedMessages[normalizedMessages.length - 1];
  const response = await requestWithRefresh(
    `/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        title: titleFromMessages(normalizedMessages) || "新しい検索",
        lastMessage: lastMessage?.content ?? "",
        category: normalizedMessages.find((message) => message.role === "user")?.category ?? "",
        messageCount: normalizedMessages.length,
        toolCallCount,
        timestamp: lastMessage?.timestamp ?? Date.now(),
      }),
    },
  );
  const data = await parseJsonResponse<{ session?: ChatSession }>(response, {});
  return data.session ? normalizeSession(data.session) : null;
}

export async function listMemoryMessages(sessionId: string): Promise<ChatMessage[]> {
  if (!MEMORY_URL) return [];

  const response = await requestWithRefresh(
    `/sessions/${encodeURIComponent(sessionId)}/events`,
    { method: "GET" },
  );
  const data = await parseJsonResponse<{ messages?: ChatMessage[] }>(response, {});
  return (data.messages ?? []).map(normalizeMessage);
}

export async function deleteMemorySession(sessionId: string): Promise<void> {
  if (!MEMORY_URL) return;

  const response = await requestWithRefresh(
    `/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  await parseJsonResponse(response, {});
}
