"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/chat-message";

type Message = {
  id: number;
  role: "user" | "bot";
  text: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
};

const EXAMPLE_QUESTIONS = [
  "Where should I sell Bexalite?",
  "Best place to buy Laranite",
  "What's the price of Agricium?",
  "Best trade route for Quantanium",
  "Tell me about Titanium",
  "Best trade route from Hurston",
];

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  let nextId = useRef(0);

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector("[data-slot='scroll-area-viewport']");
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [messages, loading]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: nextId.current++,
      role: "user",
      text: text.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      });

      const data = await res.json();

      const botMsg: Message = {
        id: nextId.current++,
        role: "bot",
        text: data.text,
        table: data.table,
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "bot",
          text: "Failed to connect. Please check your connection and try again.",
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <Card className="flex flex-col h-[calc(100vh-6rem)] max-w-3xl mx-auto">
      <div className="p-4 border-b">
        <h1 className="text-lg font-semibold">UEX Trade Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Ask about Star Citizen commodity prices, trade routes, and more
        </p>
      </div>

      <ScrollArea className="flex-1 min-h-0 overflow-hidden p-4" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-12">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">
                Star Citizen Trade Bot
              </h2>
              <p className="text-muted-foreground text-sm">
                Powered by UEX Corp data. Ask me anything about commodity
                trading!
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {EXAMPLE_QUESTIONS.map((q) => (
                <Button
                  key={q}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => sendMessage(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            text={msg.text}
            table={msg.table}
          />
        ))}
        {loading && (
          <div className="flex justify-start mb-4">
            <div className="bg-muted rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce [animation-delay:0.3s]" />
              </div>
            </div>
          </div>
        )}
      </ScrollArea>

      <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about commodity prices, trade routes..."
          disabled={loading}
          autoFocus
        />
        <Button type="submit" disabled={loading || !input.trim()}>
          Send
        </Button>
      </form>
    </Card>
  );
}
