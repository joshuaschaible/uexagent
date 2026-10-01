import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = stripTypeScriptTypes(await readFile(new URL("../src/lib/chat-store.ts", import.meta.url), "utf8"));
const { loadReferenceChat, saveReferenceChat } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("one reference chat migrates the latest conversation and preserves the older archive", (t) => {
  const storage = new Map();
  globalThis.window = {};
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  t.after(() => { delete globalThis.window; delete globalThis.localStorage; });
  const archive = JSON.stringify([{id:"old",updatedAt:1,messages:[]},{id:"latest",updatedAt:2,messages:[{role:"user",text:"Where can I mine Gold?"}]}]);
  storage.set("uex-chats", archive);
  const chat = loadReferenceChat();
  assert.equal(chat.id, "latest");
  assert.equal(storage.get("uex-chats"), archive);
  const updated = {...chat,messages:[...chat.messages,{role:"user",text:"Where can I buy a ship?"}]};
  saveReferenceChat(updated);
  assert.deepEqual(loadReferenceChat(),updated);
  assert.equal(storage.get("uex-chats"),archive);
});
