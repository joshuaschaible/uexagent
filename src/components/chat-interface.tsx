"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Menu, RefreshCw, AtSign } from "lucide-react";
import { ShipSelector } from "@/components/ship-selector";
import { FleetSettings } from "@/components/fleet-settings";
import {
  loadFleet,
  saveFleet,
  loadActiveShipId,
  saveActiveShipId,
  type FleetShip,
} from "@/lib/fleet-store";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChatMessage } from "@/components/chat-message";
import { ChatSidebar } from "@/components/chat-sidebar";
import { Typeahead } from "@/components/typeahead";
import { MentionBackdrop } from "@/components/mention-backdrop";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Message, Conversation } from "@/lib/types";
import {
  loadConversations,
  saveConversation,
  deleteConversation as deleteConv,
  createConversation,
  createMessage,
  titleFromMessage,
} from "@/lib/chat-store";

const EXAMPLE_SECTIONS = [
  {
    label: "🔄 Trading",
    questions: [
      "Where should I sell Bexalite?",
      "Buy Laranite on Hurston",
      "I have 50000 aUEC, what should I trade?",
      "Best trade route for Quantanium",
    ],
  },
  {
    label: "📊 Market Data",
    questions: [
      "What's the most profitable commodity?",
      "Show me all metals",
      "Compare Laranite prices in Stanton vs Pyro",
      "Price history of Agricium",
    ],
  },
  {
    label: "🚀 Ships & Locations",
    questions: [
      "Compare C2 vs Caterpillar",
      "Best trades for my C2 and Caterpillar",
      "Space stations in Stanton",
      "Outposts on Hurston",
    ],
  },
];

export function ChatInterface() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showHints, setShowHints] = useState(true);
  const [typeaheadVisible, setTypeaheadVisible] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mentions, setMentions] = useState<{ value: string; type: string }[]>([]);
  const [fleet, setFleet] = useState<FleetShip[]>([]);
  const [activeShipId, setActiveShipId] = useState<number | null>(null);
  const [fleetSettingsOpen, setFleetSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  const messages = activeConv?.messages ?? [];

  // Load conversations and fleet on mount
  useEffect(() => {
    const saved = loadConversations();
    setConversations(saved);
    if (saved.length > 0) {
      setActiveConv(saved[0]);
    } else {
      const newConv = createConversation();
      setActiveConv(newConv);
    }
    setFleet(loadFleet());
    setActiveShipId(loadActiveShipId());
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

  const persistConversation = useCallback(
    (conv: Conversation) => {
      saveConversation(conv);
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== conv.id);
        return [conv, ...filtered];
      });
    },
    []
  );

  function handleAddShip(ship: FleetShip) {
    const updated = [...fleet.filter((s) => s.id !== ship.id), ship];
    setFleet(updated);
    saveFleet(updated);
  }

  function handleRemoveShip(id: number) {
    const updated = fleet.filter((s) => s.id !== id);
    setFleet(updated);
    saveFleet(updated);
    if (activeShipId === id) {
      setActiveShipId(null);
      saveActiveShipId(null);
    }
  }

  function handleSelectShip(id: number | null) {
    setActiveShipId(id);
    saveActiveShipId(id);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading || !activeConv) return;

    setShowHints(false);
    const userMsg = createMessage("user", text.trim());

    // Track for ↑ recall
    messageHistoryRef.current.push(text.trim());
    historyIndexRef.current = -1;

    const updatedMessages = [...activeConv.messages, userMsg];
    const isFirst = activeConv.messages.length === 0;
    const updatedConv: Conversation = {
      ...activeConv,
      messages: updatedMessages,
      title: isFirst ? titleFromMessage(text.trim()) : activeConv.title,
      updatedAt: Date.now(),
    };

    setActiveConv(updatedConv);
    setInput("");
    setMentions([]);
    setLoading(true);
    // Keep focus on input immediately
    requestAnimationFrame(() => inputRef.current?.focus());

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

      const activeShip = activeShipId
        ? fleet.find((s) => s.id === activeShipId)
        : undefined;

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          history,
          ...(activeShip && {
            activeShip: {
              name: activeShip.name,
              name_full: activeShip.name_full,
              scu: activeShip.scu,
              pad_type: activeShip.pad_type,
            },
          }),
        }),
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamedText = "";
      let streamedTable: Message["table"] | undefined;
      let streamedTables: Message["tables"] | undefined;
      let streamedChart: Message["chart"] | undefined;
      let streamedMap: Message["map"] | undefined;
      let streamedProfit: Message["profit"] | undefined;
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
        "Failed to connect. Please check your connection and try again.",
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
  }

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
    setActiveConv(restoredConv);
    // Re-send the message
    setTimeout(() => sendMessage(messageText), 50);
  }

  function handleNewChat() {
    const newConv = createConversation();
    setActiveConv(newConv);
    setSidebarOpen(false);
    setShowHints(true);
    setMentions([]);
    inputRef.current?.focus();
  }

  function handleSelectConversation(id: string) {
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
      setActiveConv(conv);
      setSidebarOpen(false);
      setShowHints(false);
    }
  }

  function handleDeleteConversation(id: string) {
    deleteConv(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConv?.id === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      if (remaining.length > 0) {
        setActiveConv(remaining[0]);
      } else {
        handleNewChat();
      }
    }
  }

  function handleTypeaheadSelect(value: string, isMention: boolean, type?: string) {
    if (isMention) {
      // Replace @query (including multi-word) with the selected value
      const mentionMatch = input.match(/^(.*?)(\s?)@.*$/);
      if (mentionMatch) {
        const prefix = mentionMatch[1];
        const separator = prefix.length > 0 && !prefix.endsWith(" ") ? " " : "";
        const newInput = prefix + separator + value + " ";
        setInput(newInput);
      } else {
        setInput(value + " ");
      }
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

  const sidebarContent = (
    <ChatSidebar
      conversations={conversations}
      activeId={activeConv?.id ?? null}
      onSelect={handleSelectConversation}
      onNew={handleNewChat}
      onDelete={handleDeleteConversation}
      onOpenFleetSettings={() => {
        setSidebarOpen(false);
        setFleetSettingsOpen(true);
      }}
    />
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:flex md:w-64 md:flex-col border-r border-border/50">
        {sidebarContent}
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            {/* Mobile sidebar trigger */}
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger className="md:hidden inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent cursor-pointer">
                <Menu className="h-5 w-5" />
              </SheetTrigger>
              <SheetContent side="left" showCloseButton={false}>
                <SheetTitle className="sr-only">Chat History</SheetTitle>
                {sidebarContent}
              </SheetContent>
            </Sheet>
            <div>
              <h1 className="text-base font-semibold">UEX Agent</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {cacheAge !== null && cacheAge > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span>
                  Updated{" "}
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
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
                <div className="text-center">
                  <h2 className="text-2xl font-semibold mb-2">
                    Star Citizen Trade Bot
                  </h2>
                  <p className="text-muted-foreground text-sm max-w-md">
                    Powered by UEX Corp data. Ask me anything about commodity
                    trading, ship cargo, stations, and more.
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
                map={msg.map}
                profit={msg.profit}
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
        <div className="border-t border-border/50 bg-background">
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
                  onChange={(e) => {
                    const val = e.target.value;
                    setInput(val);
                    setMentions((prev) => prev.filter((m) => val.includes(m.value)));
                    const hasMention = /(?:^|\s)@/.test(val);
                    setTypeaheadVisible(val.length >= 2 || hasMention);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    const hasMention = /(?:^|\s)@/.test(input);
                    setTypeaheadVisible(input.length >= 2 || hasMention);
                  }}
                  onBlur={() => setTimeout(() => setTypeaheadVisible(false), 200)}
                  placeholder="Ask about commodity prices, trade routes..."
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
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      if (inputRef.current) {
                        const pos = inputRef.current.selectionStart ?? input.length;
                        const before = input.slice(0, pos);
                        const after = input.slice(pos);
                        const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
                        const newVal = before + (needsSpace ? " @" : "@") + after;
                        setInput(newVal);
                        setTypeaheadVisible(true);
                        inputRef.current.focus();
                      }
                    }}
                  >
                    <AtSign className="h-4 w-4" strokeWidth={3} />
                  </Button>
                  <ShipSelector
                    fleet={fleet}
                    activeShipId={activeShipId}
                    onSelectShip={handleSelectShip}
                    onOpenFleetSettings={() => setFleetSettingsOpen(true)}
                  />
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

      {/* Fleet settings sheet */}
      <FleetSettings
        open={fleetSettingsOpen}
        onOpenChange={setFleetSettingsOpen}
        fleet={fleet}
        onAddShip={handleAddShip}
        onRemoveShip={handleRemoveShip}
      />
    </div>
  );
}
