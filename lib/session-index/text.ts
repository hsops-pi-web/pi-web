const MAX_SEARCH_TEXT = 20_000;

export function truncateSearchText(text: string): string {
  return text.length > MAX_SEARCH_TEXT ? text.slice(0, MAX_SEARCH_TEXT) : text;
}

export function extractMessageText(message: unknown): string {
  const value = message as { content?: unknown };
  const content = value.content;
  if (typeof content === "string") return truncateSearchText(content);
  if (!Array.isArray(content)) return "";

  const parts = content.flatMap((block) => {
    const item = block as { type?: string; text?: unknown; thinking?: unknown; input?: unknown };
    if (item.type === "text" && typeof item.text === "string") return [item.text];
    if (item.type === "thinking" && typeof item.thinking === "string") return [item.thinking];
    if (item.type === "toolCall" && item.input) return [JSON.stringify(item.input)];
    return [];
  });

  return truncateSearchText(parts.join("\n"));
}
