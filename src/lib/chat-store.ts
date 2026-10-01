import type { Conversation, Message } from "./types";

const STORAGE_KEY = "uex-chats";
const MAX_CONVERSATIONS = 50;
const REFERENCE_CHAT_KEY = "uex-reference-chat";

export function loadReferenceChat(): Conversation | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(REFERENCE_CHAT_KEY);
    if (saved) return JSON.parse(saved) as Conversation;
    // Migrate the latest chat without deleting the former chat archive.
    const latest = loadConversations()[0];
    if (latest) saveReferenceChat(latest);
    return latest ?? null;
  } catch { return null; }
}

export function saveReferenceChat(conversation: Conversation): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(REFERENCE_CHAT_KEY, JSON.stringify(conversation)); }
  catch { /* Storage may be unavailable or full. */ }
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveConversation(conversation: Conversation): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadConversations();
    const idx = all.findIndex((c) => c.id === conversation.id);
    if (idx >= 0) {
      all[idx] = conversation;
    } else {
      all.unshift(conversation);
    }
    // Keep only recent conversations
    const trimmed = all.slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable
  }
}

export function deleteConversation(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadConversations();
    const filtered = all.filter((c) => c.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

export function createConversation(): Conversation {
  return {
    id: generateId(),
    title: "New Chat",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function titleFromMessage(text: string): string {
  // Use first 50 chars of first user message as title
  const clean = text.trim().replace(/\n/g, " ");
  return clean.length > 50 ? clean.slice(0, 50) + "..." : clean;
}

export function createMessage(
  role: "user" | "bot",
  text: string,
  extra?: Partial<Message>
): Message {
  return {
    id: generateId(),
    role,
    text,
    ...extra,
  };
}
