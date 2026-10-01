export type MentionSuggestion = { name: string; type: string };

export function filterMentionSuggestions<T extends MentionSuggestion>(items: T[], query: string): T[] {
  if (!query) return items;
  const lower = query.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return items.filter(item => item.name.toLowerCase().includes(lower)
    || (compact.length > 0 && item.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(compact)))
    .sort((a, b) => {
      const aName = a.name.toLowerCase(), bName = b.name.toLowerCase();
      return Number(bName === lower) - Number(aName === lower)
        || Number(bName.startsWith(lower)) - Number(aName.startsWith(lower))
        || aName.length - bName.length;
    });
}

export function insertMention(input: string, name: string, type?: string): string {
  const qualifier = type === "orbit" ? " orbit" : type === "poi" ? " point of interest" : "";
  const value = name + qualifier;
  const match = input.match(/^(.*?)(\s?)@.*$/);
  if (!match) return value + " ";
  const prefix = match[1];
  return prefix + (prefix.length > 0 && !prefix.endsWith(" ") ? " " : "") + value + " ";
}
