"use client";

import { Plus, Trash2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/types";

type ChatSidebarProps = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenFleetSettings: () => void;
};

export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onOpenFleetSettings,
}: ChatSidebarProps) {
  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={onNew}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {conversations.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No conversations yet
          </p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-1 rounded-lg px-3 py-2 mb-0.5 cursor-pointer transition-colors ${
              conv.id === activeId
                ? "bg-muted"
                : "hover:bg-muted/50"
            }`}
            onClick={() => onSelect(conv.id)}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{conv.title}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(conv.updatedAt)}
              </p>
            </div>
            <button
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 transition-all"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border/50">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={onOpenFleetSettings}
        >
          <Rocket className="h-4 w-4" />
          My Fleet
        </Button>
      </div>
    </div>
  );
}
