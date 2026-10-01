export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_MESSAGE_LENGTH = 8_000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_NAME_LENGTH = 200;

export class RequestError extends Error {
  readonly status: number;
  readonly retryAfter?: number;

  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// A local app must also reject untrusted Host headers: checking Origin alone
// would allow a hostile website that resolves its own hostname to loopback.
export function assertTrustedHost(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const configuredOrigin = process.env.APP_ORIGIN;

  if (configuredOrigin) {
    let trusted: URL;
    try {
      trusted = new URL(configuredOrigin);
      if (!/^https?:$/.test(trusted.protocol) || trusted.origin !== configuredOrigin) {
        throw new Error("Invalid origin");
      }
    } catch {
      throw new RequestError(500, "The application origin is not configured correctly.");
    }
    if (host.toLowerCase() !== trusted.host.toLowerCase()) {
      throw new RequestError(403, "This request host is not allowed.");
    }
    return trusted.origin;
  }

  let requestHost: URL;
  try {
    requestHost = new URL(`${url.protocol}//${host}`);
  } catch {
    throw new RequestError(403, "This request host is not allowed.");
  }
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(requestHost.hostname) ||
    requestHost.host !== host.toLowerCase()
  ) {
    throw new RequestError(403, "This request host is not allowed.");
  }
  return requestHost.origin;
}

export function assertSameOrigin(request: Request) {
  const expectedOrigin = assertTrustedHost(request);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new RequestError(403, "Cross-origin requests are not allowed.");
  }
  const origin = request.headers.get("origin");
  // CLI clients have no Origin. Browsers sending one must match exactly.
  if (origin !== null && origin !== expectedOrigin) {
    throw new RequestError(403, "Cross-origin requests are not allowed.");
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError(415, "Send the request as application/json.");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RequestError(413, "The request body is too large.");
  }
  if (!request.body) throw new RequestError(400, "Send a valid JSON request body.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new RequestError(408, "The request was interrupted."));
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    timeout = setTimeout(() => reject(new RequestError(408, "The request body timed out.")), 10_000);
  });

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new RequestError(413, "The request body is too large.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new RequestError(400, "Send a valid JSON request body.");
    }
  } catch (error) {
    // Do not keep consuming an oversized, stalled, or disconnected upload.
    void reader.cancel().catch(() => {});
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "Could not read the request body.");
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ChatInput = {
  message: string;
  history: { role: "user" | "bot" | "assistant"; text: string }[];
  activeShip?: { name: string };
};

export function validateChatInput(value: unknown): ChatInput {
  if (!isRecord(value)) throw new RequestError(400, "Send a JSON object.");
  if (typeof value.message !== "string" || !value.message.trim()) {
    throw new RequestError(400, "Please enter a question about Star Citizen commodities.");
  }
  if (value.message.length > MAX_MESSAGE_LENGTH) {
    throw new RequestError(400, `Keep your question under ${MAX_MESSAGE_LENGTH} characters.`);
  }

  const history: ChatInput["history"] = [];
  if (value.history !== undefined) {
    if (!Array.isArray(value.history) || value.history.length > MAX_HISTORY_MESSAGES) {
      throw new RequestError(400, `History must contain at most ${MAX_HISTORY_MESSAGES} messages.`);
    }
    for (const item of value.history) {
      if (
        !isRecord(item) ||
        (item.role !== "user" && item.role !== "bot" && item.role !== "assistant") ||
        typeof item.text !== "string" ||
        item.text.length > MAX_MESSAGE_LENGTH
      ) {
        throw new RequestError(400, "History contains an invalid message.");
      }
      history.push({ role: item.role, text: item.text });
    }
  }

  let activeShip: ChatInput["activeShip"];
  if (value.activeShip !== undefined && value.activeShip !== null) {
    if (
      !isRecord(value.activeShip) ||
      typeof value.activeShip.name !== "string" ||
      !value.activeShip.name.trim() ||
      value.activeShip.name.length > MAX_NAME_LENGTH
    ) {
      throw new RequestError(400, "The selected ship is invalid.");
    }
    // Resolve cargo capacity and other ship attributes from trusted reference data.
    activeShip = { name: value.activeShip.name.trim() };
  }

  return { message: value.message.trim(), history, activeShip };
}

type RateWindow = { durationMs: number; max: number };
type RateState = { active: number; timestamps: number[] };

export class RequestLimiter {
  private readonly windows: RateWindow[];
  private readonly concurrency: number;
  private readonly state: RateState;

  constructor(concurrency: number, windows: RateWindow[], state: RateState = { active: 0, timestamps: [] }) {
    this.concurrency = concurrency;
    this.windows = windows;
    this.state = state;
  }

  acquire(now = Date.now()): () => void {
    const longestWindow = Math.max(...this.windows.map((window) => window.durationMs));
    this.state.timestamps = this.state.timestamps.filter((time) => now - time < longestWindow);
    for (const window of this.windows) {
      const recent = this.state.timestamps.filter((time) => now - time < window.durationMs);
      if (recent.length >= window.max) {
        const retry = Math.max(1, Math.ceil((recent[0] + window.durationMs - now) / 1000));
        throw new RequestError(429, "Too many requests. Please wait and try again.", retry);
      }
    }
    if (this.state.active >= this.concurrency) {
      throw new RequestError(429, "The assistant is busy. Please try again shortly.", 5);
    }
    this.state.timestamps.push(now);
    this.state.active += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.state.active -= 1;
      }
    };
  }
}

// Global state shares the same budget across both Next.js route modules and
// survives development module reloads. Production replicas need a shared store.
const globalState = globalThis as typeof globalThis & {
  tradeBotRequestLimitState?: { chat: RateState; cache: RateState };
};
const limits = globalState.tradeBotRequestLimitState ??= {
  chat: { active: 0, timestamps: [] },
  cache: { active: 0, timestamps: [] },
};

// Store data rather than class instances globally so separately bundled routes
// still throw their own RequestError class and return the proper HTTP status.
export const chatRequestLimiter = new RequestLimiter(4, [
    { durationMs: 60_000, max: 30 },
    { durationMs: 3_600_000, max: 300 },
  ], limits.chat);
export const cacheResetLimiter = new RequestLimiter(1, [{ durationMs: 60_000, max: 2 }], limits.cache);

export function requestErrorResponse(error: unknown): Response {
  const knownError = error instanceof RequestError;
  const text = knownError ? error.message : "Something went wrong. Please try again.";
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (knownError && error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
  return Response.json({ text }, { status: knownError ? error.status : 500, headers });
}
