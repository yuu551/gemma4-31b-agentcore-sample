import { useState, useMemo, useCallback, memo } from "react";
import {
  Check,
  Copy,
  MessageSquare,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { AssistantAvatar, UserAvatar } from "./icons";
import { Streamdown } from "streamdown";
import { streamdownPlugins } from "../lib/streamdownPlugins";
import {
  normalizeMarkdown,
  normalizeMermaidCodeFences,
} from "../lib/markdown";
import { getPresignedUrl } from "../lib/s3presign";
import { submitFeedback, type FeedbackRating } from "../lib/feedback";
import { ToolCallsIndicator } from "./ToolCallAccordion";
import {
  CATEGORIES,
  type Category,
  type ChatMessage as ChatMessageType,
} from "../types/chat";

function FeedbackControls({
  message,
  sessionId,
  question,
  feedbackCategory,
}: {
  message: ChatMessageType;
  sessionId?: string | null;
  question?: string;
  feedbackCategory?: Category | null;
}) {
  const [selected, setSelected] = useState<FeedbackRating | null>(null);
  const [isCommentOpen, setIsCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendFeedback = async (rating: FeedbackRating, commentText = "") => {
    if (!sessionId || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await submitFeedback({
        sessionId,
        messageId: message.id,
        rating,
        comment: commentText,
        question,
        answerPreview: message.content,
        category: feedbackCategory,
        toolCallCount: message.toolCalls?.length ?? 0,
      });
      setSelected(rating);
      if (commentText) {
        setComment("");
        setIsCommentOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (message.isStreaming) return null;

  const buttonClass = (rating: FeedbackRating) => (
    `grid h-7 w-7 place-items-center rounded-lg border transition ${
      selected === rating
        ? "border-aws-ember/45 bg-accent-soft text-aws-ember"
        : "border-transparent text-text-muted hover:border-surface-600 hover:bg-surface-700 hover:text-text-primary"
    }`
  );

  return (
    <div className="mt-3 border-t border-surface-600/50 pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => sendFeedback("like")}
          disabled={!sessionId || isSubmitting}
          className={buttonClass("like")}
          title="良い回答"
          aria-label="良い回答として送信"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => sendFeedback("dislike")}
          disabled={!sessionId || isSubmitting}
          className={buttonClass("dislike")}
          title="改善が必要"
          aria-label="改善が必要な回答として送信"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setIsCommentOpen((current) => !current);
            setError(null);
          }}
          disabled={!sessionId || isSubmitting}
          className={`ml-1 inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs transition ${
            isCommentOpen
              ? "border-aws-ember/45 bg-accent-soft text-aws-ember"
              : "border-transparent text-text-muted hover:border-surface-600 hover:bg-surface-700 hover:text-text-primary"
          }`}
          title="コメント"
          aria-label="コメントを入力"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          コメント
        </button>
        {selected && (
          <span className="ml-1 text-xs text-text-muted">送信済み</span>
        )}
      </div>

      {isCommentOpen && (
        <div className="mt-2 flex gap-2">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="気づいた点を残す"
            className="min-h-16 flex-1 resize-none rounded-xl border border-surface-600/70 bg-surface-900 px-3 py-2 text-sm text-text-primary outline-none transition focus:border-aws-ember/50 focus:ring-2 focus:ring-[var(--ring)]"
          />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => sendFeedback(selected ?? "comment", comment.trim())}
              disabled={!comment.trim() || isSubmitting}
              className="grid h-8 w-8 place-items-center rounded-lg bg-aws-ember text-white transition hover:brightness-105 disabled:opacity-45"
              title="送信"
              aria-label="コメントを送信"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCommentOpen(false);
                setError(null);
              }}
              className="grid h-8 w-8 place-items-center rounded-lg border border-surface-600/70 text-text-muted transition hover:bg-surface-700 hover:text-text-primary"
              title="閉じる"
              aria-label="コメント欄を閉じる"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
  sessionId,
  question,
  feedbackCategory,
}: {
  message: ChatMessageType;
  sessionId?: string | null;
  question?: string;
  feedbackCategory?: Category | null;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const category = message.category
    ? CATEGORIES.find((item) => item.value === message.category)
    : null;
  const shouldRenderBubble = isUser || message.content.trim().length > 0;

  const processedContent = useMemo(() => {
    if (isUser || !message.content) return "";
    let md = normalizeMarkdown(normalizeMermaidCodeFences(message.content));
    md = md.replace(/\(s3:\/\//g, "(#s3/");
    return md;
  }, [isUser, message.content]);

  const handleContentClick = useCallback(async (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href.startsWith("#s3/")) return;
    e.preventDefault();
    const s3Uri = "s3://" + href.slice(4);
    try {
      const url = await getPresignedUrl(s3Uri);
      window.open(url, "_blank");
    } catch {
      return;
    }
  }, []);

  const handleCopy = async () => {
    if (!message.content) return;
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fade-up">
      {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mb-2 sm:ml-14">
          <ToolCallsIndicator
            toolCalls={message.toolCalls}
            isStreaming={!!message.isStreaming}
          />
        </div>
      )}

      {shouldRenderBubble && (
        <div
          className={`group flex min-w-0 ${isUser ? "flex-row-reverse gap-3" : "gap-4"}`}
        >
          <div className="hidden flex-shrink-0 sm:block">
            {isUser ? <UserAvatar /> : <AssistantAvatar />}
          </div>

          <div
            className={`min-w-0 rounded-[1.35rem] border transition duration-200 ${
              isUser
                ? "max-w-[88%] border-aws-ember/20 bg-aws-ember px-4 py-3 text-white shadow-[var(--shadow-card)] sm:max-w-[74%]"
                : "max-w-full border-surface-600/70 bg-surface-800/88 px-5 py-4 shadow-[var(--shadow-card)] sm:max-w-[86%]"
            }`}
          >
            <div className={`mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] ${isUser ? "text-white/70" : "text-text-muted"}`}>
              {!isUser && <Sparkles className="h-3.5 w-3.5 text-aws-ember" />}
              {isUser ? "質問" : "回答"}
            </div>

            {isUser && category && (
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/14 px-2.5 py-1 text-[11px] font-medium text-white/82">
                <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                {category.label}で検索
              </div>
            )}

            <div className={`text-[15px] leading-7 ${isUser ? "text-white" : "text-text-primary"}`}>
              {isUser ? (
                <span className="whitespace-pre-wrap">{message.content}</span>
              ) : (
                <div
                  onClick={handleContentClick}
                  className="
                    [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3
                    [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2
                    [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2
                    [&_p]:mb-3 [&_p]:leading-relaxed
                    [&_ul]:mb-3 [&_ul]:pl-5 [&_ul]:list-disc
                    [&_ol]:mb-3 [&_ol]:pl-5 [&_ol]:list-decimal
                    [&_li]:mb-1.5 [&_li]:leading-relaxed
                    [&_blockquote]:border-l-3 [&_blockquote]:border-aws-ember [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary
                    [&_strong]:font-semibold
                    [&_a]:text-aws-ember [&_a]:underline [&_a]:underline-offset-2
                    [&_code]:rounded-md [&_code]:bg-surface-700 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm
                  "
                >
                  <Streamdown
                    plugins={streamdownPlugins}
                    isAnimating={!!message.isStreaming}
                    linkSafety={{ enabled: false }}
                  >
                    {processedContent}
                  </Streamdown>
                </div>
              )}
            </div>

            <div className={`mt-3 flex items-center gap-2 text-xs ${isUser ? "text-white/65" : "text-text-muted"}`}>
              <span>
                {new Date(message.timestamp).toLocaleTimeString("ja-JP", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {message.content && (
                <button
                  onClick={handleCopy}
                  className={`rounded-lg p-1 opacity-70 transition-all hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${isUser ? "hover:bg-white/10 hover:text-white" : "hover:bg-surface-700 hover:text-text-primary"}`}
                  title="コピー"
                  aria-label="メッセージをコピー"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>

            {!isUser && (
              <FeedbackControls
                message={message}
                sessionId={sessionId}
                question={question}
                feedbackCategory={feedbackCategory}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
});
