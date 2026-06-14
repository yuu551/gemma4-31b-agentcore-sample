import { useState, useCallback, useEffect } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import outputs from "../../amplify_outputs.json";
import { CATEGORIES, type Category, type ChatMessage, type ToolCall } from "../types/chat";

const RUNTIME_ARN = outputs.custom?.runtime_arn ?? "";
const REGION = outputs.custom?.aws_region ?? "us-east-1";

type AgentResult = {
  response: string;
  toolCalls: ToolCall[];
};

type AgentStreamUpdate = AgentResult;

function waitForPaint(): Promise<void> {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    typeof requestAnimationFrame === "function"
  ) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  return new Promise((resolve) => {
    setTimeout(resolve, 16);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonIfPossible(value: unknown): unknown {
  let parsed = value;

  for (let i = 0; i < 3; i += 1) {
    if (typeof parsed !== "string") return parsed;

    const trimmed = parsed.trim();
    if (!trimmed) return trimmed;

    const first = trimmed[0];
    if (first !== "{" && first !== "[" && first !== "\"") return trimmed;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return parsed;
    }
  }

  return parsed;
}

function extractDataPayloads(raw: string): string[] {
  const payloads = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");

  return payloads.length > 0 ? payloads : [raw.trim()];
}

function normalizeToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is ToolCall => (
    isRecord(item) &&
    typeof item.name === "string" &&
    isRecord(item.input)
  ));
}

function firstStringField(
  record: Record<string, unknown>,
  fields: string[],
): string {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function normalizeAgentResult(value: unknown): AgentResult {
  const parsed = parseJsonIfPossible(value);

  if (typeof parsed === "string") {
    return { response: parsed, toolCalls: [] };
  }

  if (!isRecord(parsed)) {
    throw new Error("Agent response format is not supported");
  }

  const response = firstStringField(parsed, [
    "response",
    "message",
    "content",
    "output",
    "text",
  ]);

  if (!response) {
    throw new Error("Agent response did not include response text");
  }

  return {
    response,
    toolCalls: normalizeToolCalls(parsed.toolCalls),
  };
}

function parseStreamPayload(payload: string): {
  content: string;
  isSnapshot: boolean;
  toolCalls: ToolCall[];
} | null {
  const parsed = parseJsonIfPossible(payload);

  if (typeof parsed === "string") {
    return parsed
      ? { content: parsed, isSnapshot: false, toolCalls: [] }
      : null;
  }

  if (!isRecord(parsed)) return null;

  const toolCalls = normalizeToolCalls(parsed.toolCalls);
  const delta = firstStringField(parsed, ["delta", "chunk", "token"]);
  if (delta) return { content: delta, isSnapshot: false, toolCalls };

  const snapshot = firstStringField(parsed, ["response", "message", "output"]);
  if (snapshot) return { content: snapshot, isSnapshot: true, toolCalls };

  const text = firstStringField(parsed, ["content", "text"]);
  if (text) return { content: text, isSnapshot: false, toolCalls };

  return toolCalls.length > 0
    ? { content: "", isSnapshot: false, toolCalls }
    : null;
}

export function parseAgentRuntimeResponse(raw: string): AgentResult {
  const payloads = extractDataPayloads(raw);
  let latestResult: AgentResult | null = null;
  const textChunks: string[] = [];

  for (const payload of payloads) {
    const parsed = parseJsonIfPossible(payload);

    if (typeof parsed === "string" && parsed.trim()) {
      textChunks.push(parsed);
      continue;
    }

    if (isRecord(parsed) && (
      "response" in parsed ||
      "message" in parsed ||
      "content" in parsed ||
      "output" in parsed ||
      "text" in parsed
    )) {
      latestResult = normalizeAgentResult(parsed);
    }
  }

  if (latestResult) return latestResult;

  if (textChunks.length > 0) {
    return { response: textChunks.join(""), toolCalls: [] };
  }

  return normalizeAgentResult(raw);
}

async function readAgentRuntimeStream(
  stream: ReadableStream<Uint8Array>,
  onUpdate: (update: AgentStreamUpdate) => void,
): Promise<AgentResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let accumulated = "";
  let latestSnapshot = "";
  let latestToolCalls: ToolCall[] = [];
  let receivedUpdate = false;

  const currentResult = (): AgentResult => ({
    response: latestSnapshot || accumulated,
    toolCalls: latestToolCalls,
  });

  const handlePayload = (payload: string): boolean => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return false;

    const update = parseStreamPayload(trimmed);
    if (!update) return false;

    receivedUpdate = true;
    if (update.toolCalls.length > 0) latestToolCalls = update.toolCalls;

    if (update.content) {
      if (update.isSnapshot) {
        latestSnapshot = update.content;
      } else if (latestSnapshot) {
        latestSnapshot += update.content;
      } else {
        accumulated += update.content;
      }
    }

    const result = currentResult();
    if (result.response || result.toolCalls.length > 0) {
      onUpdate(result);
      return true;
    }

    return false;
  };

  const processLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return handlePayload(trimmed.startsWith("data:") ? trimmed.slice(5) : trimmed);
  };

  const processBuffer = async (flush = false) => {
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? "" : lines.pop() ?? "";

    for (const line of lines) {
      const didUpdate = processLine(line);
      if (didUpdate) await waitForPaint();
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    buffer += chunk;
    await processBuffer();
  }

  const tail = decoder.decode();
  if (tail) {
    raw += tail;
    buffer += tail;
  }
  await processBuffer(true);

  const result = currentResult();
  if (receivedUpdate && result.response) return result;
  if (!raw) throw new Error("Empty response from agent runtime");

  return parseAgentRuntimeResponse(raw);
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  const session = await fetchAuthSession({ forceRefresh });
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error("Cognito access token is not available");
  }
  return token;
}

function runtimeInvokeUrl(runtimeArn: string): string {
  return `https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${encodeURIComponent(runtimeArn)}/invocations?qualifier=DEFAULT`;
}

async function invokeRuntime(
  runtimeArn: string,
  sessionId: string,
  body: string,
  accessToken: string,
): Promise<Response> {
  return fetch(runtimeInvokeUrl(runtimeArn), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
    },
    body,
  });
}

async function invokeAgent(
  prompt: string,
  sessionId: string,
  onUpdate: (update: AgentStreamUpdate) => void,
): Promise<AgentResult> {
  if (!RUNTIME_ARN) {
    const result = await simulateAgent(prompt);
    onUpdate(result);
    return result;
  }

  const payload = JSON.stringify({
    prompt,
    sessionId,
    userId: "demo-user",
  });

  let response = await invokeRuntime(RUNTIME_ARN, sessionId, payload, await getAccessToken());
  if (response.status === 401) {
    response = await invokeRuntime(RUNTIME_ARN, sessionId, payload, await getAccessToken(true));
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agent runtime failed: ${response.status} ${errorText}`);
  }
  if (!response.body) throw new Error("Empty response from agent runtime");

  return readAgentRuntimeStream(response.body, onUpdate);
}

const DEMO_RESPONSE = `### リモートワーク規程について

規程を確認したところ、以下の通りです。

#### 基本ルール

当社では**週3日まで**リモートワークが可能です。申請はHRシステムから前日17時までに行ってください。

#### コアタイム

リモートワーク中は以下を遵守してください:

- Slackのステータスを「リモート」に設定
- コアタイム（10:00-15:00）は即応可能な状態を維持
- VPN接続が必須

#### 勤務場所

自宅以外の場所での業務は、セキュリティ要件を満たす場合に限り許可されます。

> 参照: リモートワーク規程`;

function buildPrompt(content: string, category?: Category | null): string {
  if (!category) return content;

  const label = CATEGORIES.find((item) => item.value === category)?.label ?? category;
  return [
    `検索対象カテゴリ: ${label}`,
    "カテゴリに該当する文書を優先し、根拠が曖昧な場合はその旨を短く明記してください。",
    "",
    `質問: ${content}`,
  ].join("\n");
}

function simulateAgent(
  prompt: string,
): Promise<{ response: string; toolCalls: ToolCall[] }> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        response: DEMO_RESPONSE,
        toolCalls: [
          {
            name: "knowledge_search",
            input: { query: prompt, category: "hr" },
            result: JSON.stringify(
              [
                { title: "リモートワーク規程", category: "hr", score: 0.92 },
                { title: "休暇取得規程", category: "hr", score: 0.69 },
              ],
              null,
              2,
            ),
            status: "done" as const,
          },
        ],
      });
    }, 800);
  });
}

interface UseChatOptions {
  initialMessages?: ChatMessage[];
  sessionId?: string | null;
  onMessagesChange?: (messages: ChatMessage[], sessionId?: string | null) => void;
}

export function useChat({
  initialMessages = [],
  sessionId,
  onMessagesChange,
}: UseChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  const sendMessage = useCallback(
    async (
      content: string,
      options: { category?: Category | null; sessionId?: string | null } = {},
    ) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        category: options.category ?? null,
        timestamp: Date.now(),
      };
      const agentPrompt = buildPrompt(content, options.category);

      const withUser = [...messages, userMsg];
      setMessages(withUser);
      setIsLoading(true);

      try {
        const requestedSessionId = options.sessionId ?? sessionId;
        const effectiveSessionId = requestedSessionId && requestedSessionId.length >= 33
          ? requestedSessionId
          : crypto.randomUUID() + crypto.randomUUID().slice(0, 1);
        const assistantId = crypto.randomUUID();
        const ts = Date.now();
        let latestMsg: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          toolCalls: [],
          timestamp: ts,
          isStreaming: true,
        };

        const applyAssistantUpdate = (
          result: AgentResult,
          isStreaming: boolean,
        ) => {
          if (!result.response && result.toolCalls.length === 0) return;

          const msg: ChatMessage = {
            id: assistantId,
            role: "assistant",
            content: result.response,
            toolCalls: result.toolCalls,
            timestamp: ts,
            isStreaming,
          };
          latestMsg = msg;

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.id === assistantId) {
              const next = [...prev];
              next[next.length - 1] = msg;
              return next;
            }
            return [...prev, msg];
          });
        };

        const result = await invokeAgent(
          agentPrompt,
          effectiveSessionId,
          (update) => {
            applyAssistantUpdate(update, true);
          },
        );

        applyAssistantUpdate(result, false);
        setIsLoading(false);
        onMessagesChange?.(
          [...withUser, { ...latestMsg, isStreaming: false }],
          effectiveSessionId,
        );
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
          timestamp: Date.now(),
        };
        setMessages([...withUser, errorMsg]);
        setIsLoading(false);
        onMessagesChange?.([...withUser, errorMsg], options.sessionId ?? sessionId);
      }
    },
    [messages, sessionId, onMessagesChange],
  );

  return { messages, isLoading, sendMessage };
}
