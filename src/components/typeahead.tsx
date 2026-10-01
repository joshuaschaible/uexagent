"use client";

import { filterMentionSuggestions } from "@/lib/mention-input";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

type Suggestion = {
  name: string;
  type: "commodity" | "ship" | "system" | "planet" | "moon" | "station" | "orbit" | "poi" | "item";
};

type TypeaheadProps = {
  query: string;
  onSelect: (value: string, isMention: boolean, type?: string) => void;
  visible: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
};

const TYPE_BADGES: Record<string, { label: string }> = {
  commodity: { label: "Commodity" },
  ship: { label: "Ship" },
  system: { label: "System" },
  planet: { label: "Planet" },
  moon: { label: "Moon" },
  station: { label: "Station" },
  orbit: { label: "Orbit / Lagrange" },
  poi: { label: "Point of interest" },
  item: { label: "Equipment" },
};

function validSuggestions(value: unknown): Suggestion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Suggestion => item !== null && typeof item === "object"
    && typeof item.name === "string" && typeof item.type === "string" && Object.hasOwn(TYPE_BADGES, item.type));
}

export function Typeahead({ query, onSelect, visible, inputRef }: TypeaheadProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [plainSuggestions, setPlainSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [resultsQuery, setResultsQuery] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cache all mention items — fetched once, filtered client-side
  const mentionCacheRef = useRef<Suggestion[]>([]);
  const mentionCacheFetchedRef = useRef(false);

  // Detect @ mention trigger — allow multi-word queries after @
  const mentionQuery = query.match(/(?:^|\s)@(.*)$/)?.[1] ?? null;
  const mentionMode = mentionQuery !== null;

  // Fetch all mention items once and cache
  const ensureMentionCache = useCallback(async () => {
    if (mentionCacheFetchedRef.current) return mentionCacheRef.current;
    try {
      const res = await fetch("/api/suggest?q=*&typed=1");
      if (!res.ok) return [];
      const data = validSuggestions(await res.json());
      mentionCacheRef.current = data;
      mentionCacheFetchedRef.current = true;
      return data;
    } catch {
      return [];
    }
  }, []);

  // Filter cached mentions client-side, sorted by relevance
  const filterMentions = filterMentionSuggestions;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    // Check for @ mention
    if (mentionQuery !== null) {
      // Fetch cache (no-op if already cached), then filter client-side
      ensureMentionCache().then((cached) => {
        if (cancelled) return;
        const filtered = filterMentions(cached, mentionQuery.trim());
        setSuggestions(filtered);
        setPlainSuggestions([]);
        setSelectedIndex(0);
        setResultsQuery(query);
      });
      // Typed lookups include geography and the independently loaded component catalogue.
      const controller = new AbortController();
      const timer = mentionQuery.trim().length >= 2 ? setTimeout(async () => {
        try {
          const res = await fetch(`/api/suggest?q=${encodeURIComponent(mentionQuery.trim())}&typed=1`, { signal: controller.signal });
          if (!res.ok) return;
          const results = validSuggestions(await res.json());
          await ensureMentionCache();
          if (cancelled) return;
          setSuggestions(filterMentions(results, mentionQuery.trim()));
          setPlainSuggestions([]);
          setSelectedIndex(0);
          setResultsQuery(query);
        } catch {
          // Cached suggestions stay usable when expanded lookups are unavailable.
        }
      }, 200) : undefined;
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        controller.abort();
      };
    }

    // Regular typeahead on last word
    const lastWord = query.split(/\s+/).pop() || "";
    if (lastWord.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(lastWord)}`, { signal: controller.signal });
        if (!res.ok) return;
        const data: string[] = await res.json();
        if (cancelled) return;
        setPlainSuggestions(data);
        setSuggestions([]);
        setSelectedIndex(0);
        setResultsQuery(query);
      } catch {
        // Obsolete or failed requests do not replace the current suggestions.
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, visible, mentionQuery, ensureMentionCache, filterMentions]);

  const allItems = useMemo(
    () => visible && resultsQuery === query
      ? (mentionMode ? suggestions.map((s) => s.name) : plainSuggestions)
      : [],
    [visible, resultsQuery, query, mentionMode, suggestions, plainSuggestions]
  );

  useEffect(() => {
    if (allItems.length === 0) return;

    function handleKeyDown(e: KeyboardEvent) {
      const items = allItems;
      const idx = selectedIndex;
      const mention = mentionMode;
      const select = onSelect;
      const sugs = suggestions;
      if (items.length === 0) return;

      const selectedType = mention && sugs[idx] ? sugs[idx].type : undefined;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        select(items[idx], mention, selectedType);
        setSuggestions([]);
        setPlainSuggestions([]);
      } else if (e.key === "Enter" && mention) {
        // In mention mode, Enter selects the suggestion
        e.preventDefault();
        e.stopPropagation();
        select(items[idx], mention, selectedType);
        setSuggestions([]);
        setPlainSuggestions([]);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        setSuggestions([]);
        setPlainSuggestions([]);
      }
    }

    const input = inputRef.current;
    if (input) {
      input.addEventListener("keydown", handleKeyDown, true);
      return () => input.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [allItems, selectedIndex, mentionMode, onSelect, suggestions, inputRef]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (allItems.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    const scrollable = container.querySelector("[class*='overflow-y-auto']");
    const selected = scrollable?.querySelector(`[data-index="${selectedIndex}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, allItems.length]);

  if (allItems.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50 flex flex-col max-h-[400px]"
    >
      {mentionMode && (
        <div className="px-3 py-1.5 border-b border-border/50 text-[10px] text-muted-foreground uppercase tracking-wider">
          Mention a commodity, ship, equipment item, or location
        </div>
      )}
      <div className="overflow-y-auto flex-1">
        {mentionMode
          ? suggestions.map((s, i) => {
              const badge = TYPE_BADGES[s.type];
              return (
                <button
                  key={`${s.type}-${s.name}`}
                  data-index={i}
                  className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    i === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(s.name, true, s.type);
                    setSuggestions([]);
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="truncate">{s.name}</span>
                  {badge && (
                    <span
                      className="entity-label text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium"
                    >
                      {badge.label}
                    </span>
                  )}
                </button>
              );
            })
          : plainSuggestions.map((s, i) => (
              <button
                key={s}
                data-index={i}
                className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-colors ${
                  i === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(s, false);
                  setPlainSuggestions([]);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {s}
              </button>
            ))}
      </div>
    </div>
  );
}
