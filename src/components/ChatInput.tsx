import { useState, useRef, useEffect } from "react";
import { Loader2, Search, Send } from "lucide-react";
import { CategoryFilter } from "./CategoryFilter";
import type { Category } from "../types/chat";

interface Props {
  onSend: (message: string) => void;
  isLoading: boolean;
  selectedCategory: Category | null;
  onCategoryChange: (category: Category | null) => void;
}

export function ChatInput({
  onSend,
  isLoading,
  selectedCategory,
  onCategoryChange,
}: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <div className="border-t border-surface-600/60 bg-surface-900/78 px-4 py-4 shadow-[0_-18px_60px_rgba(0,0,0,0.08)] backdrop-blur-xl sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex items-center justify-between gap-3">
          <CategoryFilter
            selected={selectedCategory}
            onChange={onCategoryChange}
          />
          <div className="hidden items-center gap-1.5 text-[11px] text-text-muted sm:flex">
            <Search className="h-3.5 w-3.5" />
            Ctrl+Enter
          </div>
        </div>
        <div className="flex items-end gap-3 rounded-[1.35rem] border border-surface-600/80 bg-surface-800 p-2 shadow-[var(--shadow-card)] transition focus-within:border-aws-ember/45 focus-within:shadow-[var(--shadow-elevated)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="質問を入力..."
            rows={1}
            className="max-h-[120px] min-h-12 flex-1 resize-none bg-transparent px-3 py-3
              text-sm text-text-primary placeholder-text-muted
              outline-none transition-all"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-aws-ember text-white
              shadow-[var(--shadow-subtle)] transition duration-200 hover:-translate-y-0.5 hover:bg-accent-strong
              disabled:translate-y-0 disabled:opacity-35"
            aria-label="送信"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
