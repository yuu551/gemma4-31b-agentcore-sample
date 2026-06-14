import { useState } from "react";
import {
  Search,
  List,
  Wrench,
  BookOpen,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { ToolCall } from "../types/chat";
import type { LucideIcon } from "lucide-react";

const TOOL_MAP: Record<
  string,
  { label: string; icon: LucideIcon; description: string }
> = {
  knowledge_search: {
    label: "ドキュメント検索",
    icon: Search,
    description: "関連文書を確認しています",
  },
  vector_search: {
    label: "ドキュメント検索",
    icon: Search,
    description: "関連文書を確認しています",
  },
  list_categories: {
    label: "カテゴリ一覧",
    icon: List,
    description: "関連文書を確認しています",
  },
};

const GATEWAY_TOOL_MAP: Record<string, string> = {
  "aws___search_documentation": "AWS ドキュメント検索",
  "aws__search_documentation": "AWS ドキュメント検索",
  "aws___read_documentation": "AWS ドキュメント閲覧",
  "aws__read_documentation": "AWS ドキュメント閲覧",
  "aws___recommend": "AWS レコメンド",
  "aws__recommend": "AWS レコメンド",
  "aws___get_regional_availability": "リージョン対応確認",
  "aws__get_regional_availability": "リージョン対応確認",
  "aws___list_regions": "リージョン一覧",
  "aws__list_regions": "リージョン一覧",
  "aws___retrieve_skill": "AWS スキル取得",
  "aws__retrieve_skill": "AWS スキル取得",
};

function getToolDisplay(name: string) {
  if (TOOL_MAP[name]) return TOOL_MAP[name];

  const gwMatch = name.match(/^aws[-_]knowledge_{2,3}/);
  if (gwMatch) {
    const suffix = name.slice(gwMatch[0].length);
    const label = GATEWAY_TOOL_MAP[suffix] ?? suffix.replace(/___/g, " / ");
    return {
      label,
      icon: BookOpen,
      description: "AWS公式ドキュメントを検索しています",
    };
  }

  return { label: name, icon: Wrench, description: "" };
}

function ToolCallItemStreaming({ toolCall }: { toolCall: ToolCall }) {
  const { label, icon: Icon, description } = getToolDisplay(toolCall.name);
  const isDone = toolCall.status === "done";

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-full border border-surface-600/70 bg-surface-800/82 px-3 py-2 shadow-[var(--shadow-subtle)]">
      <Icon className="h-4 w-4 flex-shrink-0 text-aws-ember" />
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      {isDone ? (
        <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
      ) : (
        <>
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-muted" />
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </>
      )}
    </div>
  );
}

function ToolCallItemCollapsed({ toolCall }: { toolCall: ToolCall }) {
  const { label, icon: Icon } = getToolDisplay(toolCall.name);

  return (
    <div className="flex items-center gap-2.5 py-1">
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-aws-ember" />
      <span className="text-sm text-text-secondary">{label}</span>
      <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
    </div>
  );
}

export function ToolCallsIndicator({
  toolCalls,
  isStreaming,
}: {
  toolCalls: ToolCall[];
  isStreaming: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (toolCalls.length === 0) return null;

  if (isStreaming) {
    return (
      <div className="flex flex-wrap gap-2 py-1">
        {toolCalls.map((tc, i) => (
          <ToolCallItemStreaming key={`${tc.name}-${i}`} toolCall={tc} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-full border border-surface-600/70 bg-surface-800 px-3 py-1.5 text-xs text-text-secondary shadow-[var(--shadow-subtle)] transition-colors hover:bg-surface-700"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Wrench className="h-3 w-3 text-aws-ember" />
        <span>{toolCalls.length}件のツールを使用</span>
      </button>
      {isOpen && (
        <div className="mt-1 rounded-2xl border border-surface-600/60 bg-surface-800/72 px-3 py-2 shadow-[var(--shadow-subtle)]">
          {toolCalls.map((tc, i) => (
            <ToolCallItemCollapsed key={`${tc.name}-${i}`} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  );
}
