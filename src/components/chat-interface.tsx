"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, RefreshCw, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat-message";
import { Typeahead } from "@/components/typeahead";
import { insertMention } from "@/lib/mention-input";
import { MentionBackdrop } from "@/components/mention-backdrop";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Message, Conversation } from "@/lib/types";
import {
  loadReferenceChat,
  saveReferenceChat,
  createConversation,
  createMessage,
  titleFromMessage,
} from "@/lib/chat-store";

const EXAMPLE_SECTIONS = [
  {
    label: "🔧 Crafting & Missions",
    questions: ["What materials do I need to craft an XL-1 quantum drive?", "How do I unlock the XL-1 blueprint?", "Tell me about the Blackbox Retrieval mission"],
  },
  {
    label: "📍 Shops & Prices",
    questions: [
      "Where's the best place to sell Laranite?",
      "What ships can I buy at New Deal in Lorville?",
      "Where can I buy Abrade Scraper Module?",
      "Where can I buy Quantanium near Hurston?",
    ],
  },
  {
    label: "📊 Market, Mining & Refining",
    questions: [
      "Where can I mine Laranite?",
      "Price history of Laranite",
      "Latest market alerts in Stanton",
      "Where should I refine Quantanium?",
    ],
  },
  {
    label: "🚀 Ships, Equipment & Locations",
    questions: [
      "Where can I buy the Caterpillar in-game?",
      "Show mining lasers",
      "Tell me about the C2 Hercules",
      "What space stations have a refinery?",
    ],
  },
];

export function ChatInterface() {
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHints, setShowHints] = useState(true);
  const [typeaheadVisible, setTypeaheadVisible] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mentions, setMentions] = useState<{ value: string; type: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  const messages = activeConv?.messages ?? [];

  function cancelPendingBlur() {
    if (blurTimerRef.current !== null) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }

  useEffect(() => () => {
    if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current);
  }, []);

  // Resume one continuous chat; older conversations remain in local storage.
  useEffect(() => {
    const timer = window.setTimeout(() => setActiveConv(loadReferenceChat() ?? createConversation()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Fetch cache age periodically
  useEffect(() => {
    async function fetchCacheAge() {
      try {
        const res = await fetch("/api/cache-status");
        const data = await res.json();
        setCacheAge(data.ageMs);
      } catch { /* ignore */ }
    }
    fetchCacheAge();
    const interval = setInterval(fetchCacheAge, 60000);
    return () => clearInterval(interval);
  }, []);

  async function handleRefreshCache() {
    setRefreshing(true);
    try {
      await fetch("/api/cache-status", { method: "DELETE" });
      setCacheAge(0);
    } catch { /* ignore */ }
    setRefreshing(false);
  }

  // Auto-scroll
  const messageCount = messages.length;
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageCount, loading]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height =
        Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const persistConversation = useCallback((conv: Conversation) => {
    saveReferenceChat(conv);
  }, []);

  const sendMessage = useCallback(async (text: string, baseConversation = activeConv) => {
    if (!text.trim() || loading || !baseConversation) return;

    setShowHints(false);
    const userMsg = createMessage("user", text.trim());

    // Track for ↑ recall
    messageHistoryRef.current.push(text.trim());
    historyIndexRef.current = -1;

    const updatedMessages = [...baseConversation.messages, userMsg];
    const isFirst = baseConversation.messages.length === 0;
    const updatedConv: Conversation = {
      ...baseConversation,
      messages: updatedMessages,
      title: isFirst ? titleFromMessage(text.trim()) : baseConversation.title,
      updatedAt: Date.now(),
    };

    setActiveConv(updatedConv);
    setInput("");
    setMentions([]);
    setLoading(true);
    // Keep focus on input immediately
    requestAnimationFrame(() => inputRef.current?.focus());

    let errorText = "Failed to connect. Please check your connection and try again.";
    try {
      // Send with history for context
      const history = updatedMessages.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      // Create streaming bot message
      const botMsgId = createMessage("bot", "", { isStreaming: true }).id;
      const streamingConv: Conversation = {
        ...updatedConv,
        messages: [
          ...updatedMessages,
          { id: botMsgId, role: "bot" as const, text: "", isStreaming: true },
        ],
        updatedAt: Date.now(),
      };
      setActiveConv(streamingConv);

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          history,
        }),
      });

      if (!res.ok) {
        try {
          const error: unknown = await res.json();
          if (error && typeof error === "object" && "text" in error && typeof error.text === "string") {
            // ChatMessage renders this as escaped React text; keep server errors brief.
            errorText = error.text.trim().slice(0, 500) || errorText;
          }
        } catch {
          // Proxies and network failures may return an HTML page or an empty body.
        }
        throw new Error("Chat request rejected");
      }
      if (!res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamedText = "";
      let streamedTable: Message["table"] | undefined;
      let streamedTables: Message["tables"] | undefined;
      let streamedChart: Message["chart"] | undefined;
      let streamedMap: Message["map"] | undefined;
      let streamedProfit: Message["profit"] | undefined;
      let streamedImage: Message["image"] | undefined;
      let isLLM = false;
      let isError = false;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "text") {
              streamedText += data.content;
              setActiveConv((prev) => {
                if (!prev) return prev;
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last && last.id === botMsgId) {
                  msgs[msgs.length - 1] = { ...last, text: streamedText };
                }
                return { ...prev, messages: msgs };
              });
            } else if (data.type === "table") {
              streamedTable = data.content;
            } else if (data.type === "chart") {
              streamedChart = data.content;
            } else if (data.type === "map") {
              streamedMap = data.content;
            } else if (data.type === "profit") {
              streamedProfit = data.content;
            } else if (data.type === "image") {
              streamedImage = data.content;
            } else if (data.type === "tables") {
              streamedTables = data.content;
            } else if (data.type === "meta") {
              isLLM = data.isLLM || false;
            } else if (data.type === "error") {
              streamedText = data.content;
              isError = true;
              setActiveConv((prev) => {
                if (!prev) return prev;
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last && last.id === botMsgId) {
                  msgs[msgs.length - 1] = { ...last, text: streamedText, isError: true };
                }
                return { ...prev, messages: msgs };
              });
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }

      // Finalize the message
      const finalConv: Conversation = {
        ...updatedConv,
        messages: [
          ...updatedMessages,
          {
            id: botMsgId,
            role: "bot" as const,
            text: streamedText,
            table: streamedTable,
            tables: streamedTables,
            chart: streamedChart,
            map: streamedMap,
            image: streamedImage,
            profit: streamedProfit,
            isLLM,
            isError,
            isStreaming: false,
          },
        ],
        updatedAt: Date.now(),
      };

      setActiveConv(finalConv);
      persistConversation(finalConv);
    } catch {
      const errorMsg = createMessage(
        "bot",
        errorText,
        { isError: true }
      );
      const finalConv: Conversation = {
        ...updatedConv,
        messages: [...updatedMessages, errorMsg],
        updatedAt: Date.now(),
      };
      setActiveConv(finalConv);
      persistConversation(finalConv);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [activeConv, loading, persistConversation]);

  function handleRetry(messageText: string) {
    if (!activeConv || loading) return;
    // Remove the last bot message (the error) and re-send
    const withoutLastBot = activeConv.messages.slice(0, -1);
    // Also remove the user message that triggered it
    const withoutPair = withoutLastBot.slice(0, -1);
    const restoredConv: Conversation = {
      ...activeConv,
      messages: withoutPair,
      updatedAt: Date.now(),
    };
    void sendMessage(messageText, restoredConv);
  }

  function handleTypeaheadSelect(value: string, isMention: boolean, type?: string) {
    if (isMention) {
      setInput(insertMention(input, value, type));
      // Track mention for styled highlight
      if (type) {
        setMentions((prev) => [...prev, { value, type }]);
      }
    } else {
      // Replace the last word being typed with the selected value
      const words = input.split(/\s+/);
      words.pop();
      const newInput = words.length > 0 ? words.join(" ") + " " + value + " " : value + " ";
      setInput(newInput);
    }
    setTypeaheadVisible(false);
    inputRef.current?.focus();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
      return;
    }

    // ↑ arrow to recall previous messages
    if (e.key === "ArrowUp" && input === "") {
      e.preventDefault();
      const history = messageHistoryRef.current;
      if (history.length === 0) return;

      if (historyIndexRef.current === -1) {
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
      }
      setInput(history[historyIndexRef.current]);
    }

    if (e.key === "ArrowDown" && historyIndexRef.current >= 0) {
      e.preventDefault();
      const history = messageHistoryRef.current;
      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current++;
        setInput(history[historyIndexRef.current]);
      } else {
        historyIndexRef.current = -1;
        setInput("");
      }
    }
  }

  // Find the user message before an error for retry
  function getRetryText(msgIndex: number): string | undefined {
    if (msgIndex > 0 && messages[msgIndex - 1]?.role === "user") {
      return messages[msgIndex - 1].text;
    }
    return undefined;
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-base font-semibold">UEX Agent</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {cacheAge !== null && cacheAge > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span>
                  Reference cache loaded{" "}
                  {cacheAge < 60000
                    ? "just now"
                    : `${Math.floor(cacheAge / 60000)}m ago`}
                </span>
                <button
                  onClick={handleRefreshCache}
                  disabled={refreshing}
                  className="p-0.5 rounded hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
                  title="Refresh data"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
            )}
            <ThemeToggle />
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]">
          <div className="max-w-3xl mx-auto px-4 pt-4 pb-10">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
                <div className="text-center">
                  <h2 className="text-2xl font-semibold mb-2">
                    Star Citizen Reference
                  </h2>
                  <p className="text-muted-foreground text-sm max-w-md">
                    Quick answers about mining, ships, equipment, locations,
                    and reported prices. Powered by UEX Corp data.
                  </p>
                </div>
                <div className="w-full max-w-xl space-y-4">
                  {EXAMPLE_SECTIONS.map((section) => (
                    <div key={section.label}>
                      <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
                        {section.label}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {section.questions.map((q) => (
                          <button
                            key={q}
                            className="px-3 py-1.5 text-xs rounded-full border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
                            onClick={() => sendMessage(q)}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, idx) => (
              <ChatMessage
                key={msg.id}
                role={msg.role}
                text={msg.text}
                table={msg.table}
                tables={msg.tables}
                chart={msg.chart}
                image={msg.image}
                isError={msg.isError}
                isLLM={msg.isLLM}
                isStreaming={msg.isStreaming}
                retryText={
                  msg.isError ? getRetryText(idx) : undefined
                }
                onRetry={handleRetry}
              />
            ))}
            {loading && !messages.some((m) => m.isStreaming) && (
              <div className="flex gap-3 py-4 animate-in fade-in duration-300">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-medium text-primary">U</span>
                </div>
                <div className="flex-1 space-y-2.5 pt-1">
                  <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-muted rounded animate-pulse [animation-delay:0.15s]" />
                  <div className="h-3 w-2/3 bg-muted rounded animate-pulse [animation-delay:0.3s]" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="bg-background">
          <form
            onSubmit={handleSubmit}
            className="max-w-3xl mx-auto px-4 py-4"
          >
            <div className="relative rounded-2xl border border-border bg-muted/30 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 transition-colors">
              <Typeahead
                query={input}
                onSelect={handleTypeaheadSelect}
                visible={typeaheadVisible}
                inputRef={inputRef}
              />
              <div className="relative mx-3 mt-3 mb-1">
                <MentionBackdrop text={input} mentions={mentions} />
                <textarea
                  ref={inputRef}
                  value={input}
                  maxLength={8000}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInput(val);
                    setMentions((prev) => prev.filter((m) => val.includes(m.value)));
                    const hasMention = /(?:^|\s)@/.test(val);
                    setTypeaheadVisible(val.length >= 2 || hasMention);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={(e) => {
                    cancelPendingBlur();
                    const val = e.currentTarget.value;
                    const hasMention = /(?:^|\s)@/.test(val);
                    setTypeaheadVisible(val.length >= 2 || hasMention);
                  }}
                  onBlur={() => {
                    cancelPendingBlur();
                    blurTimerRef.current = setTimeout(() => {
                      setTypeaheadVisible(false);
                      blurTimerRef.current = null;
                    }, 200);
                  }}
                  placeholder="Ask about mining, ships, equipment, or prices..."
                  rows={1}
                  className="relative z-10 w-full bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/60 max-h-[120px] text-transparent caret-foreground"
                />
              </div>
              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Mention an item or location"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (inputRef.current) {
                        const pos = inputRef.current.selectionStart ?? input.length;
                        const before = input.slice(0, pos);
                        const after = input.slice(inputRef.current.selectionEnd ?? pos);
                        const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
                        const newVal = before + (needsSpace ? " @" : "@") + after;
                        // Focus before opening so the focus handler cannot overwrite it.
                        inputRef.current.focus();
                        cancelPendingBlur();
                        setInput(newVal);
                        setMentions((prev) => prev.filter((m) => newVal.includes(m.value)));
                        setTypeaheadVisible(true);
                        const caret = before.length + (needsSpace ? 2 : 1);
                        requestAnimationFrame(() => inputRef.current?.setSelectionRange(caret, caret));
                      }
                    }}
                  >
                    <AtSign className="h-4 w-4" strokeWidth={3} />
                  </Button>
                </div>
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon"
                  disabled={loading || !input.trim()}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <Send className="h-4 w-4" strokeWidth={3} />
                </Button>
              </div>
            </div>
            {showHints && messages.length === 0 && (
              <p className="text-[11px] text-muted-foreground/50 text-center mt-1.5">
                ↑ previous · Enter send · Shift+Enter newline
              </p>
            )}
          </form>
        </div>
      </div>

    </div>
  );
}
