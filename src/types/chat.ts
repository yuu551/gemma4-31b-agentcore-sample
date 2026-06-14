export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  status?: "start" | "done";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  category?: Category | null;
  toolCalls?: ToolCall[];
  timestamp: number;
  isStreaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: number;
}

export type Category =
  | "hr"
  | "finance"
  | "security"
  | "engineering"
  | "operations";

export const CATEGORIES: { value: Category; label: string; description: string }[] = [
  { value: "hr", label: "人事", description: "就業規則・福利厚生" },
  { value: "finance", label: "経理", description: "経費・請求・購買" },
  { value: "security", label: "セキュリティ", description: "事故対応・権限管理" },
  { value: "engineering", label: "開発", description: "デプロイ・設計標準" },
  { value: "operations", label: "運用", description: "手順書・障害対応" },
];
