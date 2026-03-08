"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

type Suggestion = {
  name: string;
  type: "commodity" | "ship" | "system" | "planet" | "moon" | "station";
};

type TypeaheadProps = {
  query: string;
  onSelect: (value: string, isMention: boolean, type?: string) => void;
  visible: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
};

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  commodity: { label: "Commodity", className: "bg-amber-500/20 text-amber-400" },
  ship: { label: "Ship", className: "bg-blue-500/20 text-blue-400" },
  system: { label: "System", className: "bg-purple-500/20 text-purple-400" },
  planet: { label: "Planet", className: "bg-cyan-500/20 text-cyan-400" },
  moon: { label: "Moon", className: "bg-indigo-500/20 text-indigo-400" },
  station: { label: "Station", className: "bg-green-500/20 text-green-400" },
};

export function Typeahead({ query, onSelect, visible, inputRef }: TypeaheadProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [plainSuggestions, setPlainSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionMode, setMentionMode] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Cache all mention items — fetched once, filtered client-side
  const mentionCacheRef = useRef<Suggestion[]>([]);
  const mentionCacheFetchedRef = useRef(false);

  // Detect @ mention trigger — allow multi-word queries after @
  const getMentionQuery = useCallback((text: string): string | null => {
    const match = text.match(/(?:^|\s)@(.*)$/);
    return match ? match[1] : null;
  }, []);

  // Fetch all mention items once and cache
  const ensureMentionCache = useCallback(async () => {
    if (mentionCacheFetchedRef.current) return mentionCacheRef.current;
    try {
      const res = await fetch("/api/suggest?q=*&typed=1");
      const data: Suggestion[] = await res.json();
      mentionCacheRef.current = data;
      mentionCacheFetchedRef.current = true;
      return data;
    } catch {
      return [];
    }
  }, []);

  // Filter cached mentions client-side, sorted by relevance
  const filterMentions = useCallback((allItems: Suggestion[], q: string): Suggestion[] => {
    if (!q) return allItems;
    const lower = q.toLowerCase();
    return allItems
      .filter((s) => s.name.toLowerCase().includes(lower))
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        // Exact match first
        const aExact = aName === lower ? 1 : 0;
        const bExact = bName === lower ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        // Starts-with before contains
        const aStarts = aName.startsWith(lower) ? 1 : 0;
        const bStarts = bName.startsWith(lower) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        // Shorter names first (closer match)
        return aName.length - bName.length;
      });
  }, []);

  const fetchPlainSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setPlainSuggestions([]);
      return;
    }
    try {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
      const data: string[] = await res.json();
      setPlainSuggestions(data);
      setSuggestions([]);
      setSelectedIndex(0);
    } catch {
      setPlainSuggestions([]);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setSuggestions([]);
      setPlainSuggestions([]);
      setMentionMode(false);
      return;
    }

    // Check for @ mention
    const mentionQuery = getMentionQuery(query);
    if (mentionQuery !== null) {
      setMentionMode(true);
      // Fetch cache (no-op if already cached), then filter client-side
      ensureMentionCache().then((cached) => {
        const filtered = filterMentions(cached, mentionQuery.trim());
        setSuggestions(filtered);
        setPlainSuggestions([]);
        setSelectedIndex(0);
      });
      return;
    }

    // Regular typeahead on last word
    setMentionMode(false);
    setSuggestions([]);
    const lastWord = query.split(/\s+/).pop() || "";
    if (lastWord.length < 2) {
      setPlainSuggestions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPlainSuggestions(lastWord), 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, visible, getMentionQuery, ensureMentionCache, filterMentions, fetchPlainSuggestions]);

  const allItems = useMemo(
    () => (mentionMode ? suggestions.map((s) => s.name) : plainSuggestions),
    [mentionMode, suggestions, plainSuggestions]
  );

  // Use refs so the keydown handler always has fresh values without re-attaching
  const stateRef = useRef({ allItems, selectedIndex, mentionMode, onSelect, suggestions });
  stateRef.current = { allItems, selectedIndex, mentionMode, onSelect, suggestions };

  useEffect(() => {
    if (allItems.length === 0) return;

    function handleKeyDown(e: KeyboardEvent) {
      const { allItems: items, selectedIndex: idx, mentionMode: mention, onSelect: select, suggestions: sugs } = stateRef.current;
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
        setMentionMode(false);
      }
    }

    const input = inputRef.current;
    if (input) {
      input.addEventListener("keydown", handleKeyDown, true);
      return () => input.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [allItems.length > 0, inputRef]); // Only re-attach when dropdown appears/disappears

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
          Mention a commodity, ship, or location
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
                      className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium ${badge.className}`}
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
