import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { CATEGORIES, type Category } from "../types/chat";

interface Props {
  selected: Category | null;
  onChange: (category: Category | null) => void;
}

export function CategoryFilter({ selected, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedCategory = CATEGORIES.find((c) => c.value === selected);

  return (
    <div ref={ref} className="relative inline-block">
      <div
        className={`flex items-center rounded-full border text-xs font-medium shadow-[var(--shadow-subtle)] transition
          ${selected
            ? "border-aws-ember/35 bg-accent-soft text-aws-ember"
            : "border-surface-600/70 bg-surface-800 text-text-secondary"
          }`}
      >
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:text-text-primary"
          aria-expanded={isOpen}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>{selectedCategory ? selectedCategory.label : "すべてのカテゴリ"}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {selected && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="mr-1 grid h-6 w-6 place-items-center rounded-full text-aws-ember transition hover:bg-aws-ember/15"
            aria-label="カテゴリを解除"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-52 overflow-hidden rounded-2xl border border-surface-600/70 bg-surface-800 py-1.5 shadow-[var(--shadow-elevated)]">
          <button
            onClick={() => {
              onChange(null);
              setIsOpen(false);
            }}
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors
              ${!selected ? "bg-accent-soft text-aws-ember" : "text-text-primary hover:bg-surface-700"}`}
          >
            すべてのカテゴリ
            {!selected && <Check className="h-3.5 w-3.5" />}
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => {
                onChange(cat.value);
                setIsOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors
                ${selected === cat.value ? "bg-accent-soft text-aws-ember" : "text-text-primary hover:bg-surface-700"}`}
            >
              <span>
                <span className="block font-medium">{cat.label}</span>
                <span className="mt-0.5 block text-[11px] text-text-muted">{cat.description}</span>
              </span>
              {selected === cat.value && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
