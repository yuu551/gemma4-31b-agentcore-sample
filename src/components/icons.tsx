import { BookOpen, Bot, Sparkles, UserRound } from "lucide-react";

interface IconProps {
  className?: string;
}

export function AssistantAvatar({ className = "w-10 h-10" }: IconProps) {
  return (
    <div
      className={`${className} grid place-items-center rounded-2xl border border-aws-ember/25 bg-accent-soft text-aws-ember shadow-[var(--shadow-subtle)]`}
    >
      <Bot className="h-1/2 w-1/2" strokeWidth={1.8} />
    </div>
  );
}

export function UserAvatar({ className = "w-10 h-10" }: IconProps) {
  return (
    <div
      className={`${className} grid place-items-center rounded-2xl bg-aws-ember text-white shadow-[var(--shadow-card)]`}
    >
      <UserRound className="h-1/2 w-1/2" strokeWidth={1.9} />
    </div>
  );
}

export function SparkleIcon({ className = "w-5 h-5" }: IconProps) {
  return <Sparkles className={className} strokeWidth={1.8} />;
}

export function BookOpenIcon({ className = "w-5 h-5" }: IconProps) {
  return <BookOpen className={className} strokeWidth={1.8} />;
}
