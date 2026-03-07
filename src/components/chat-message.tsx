"use client";

type ChatMessageProps = {
  role: "user" | "bot";
  text: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
};

export function ChatMessage({ role, text, table }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {renderMarkdown(text)}
        </div>
        {table && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {table.headers.map((h, i) => (
                    <th
                      key={i}
                      className={`px-3 py-2 text-left font-semibold border-b ${
                        isUser
                          ? "border-primary-foreground/20"
                          : "border-border"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-3 py-2 border-b ${
                          isUser
                            ? "border-primary-foreground/10"
                            : "border-border/50"
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function renderMarkdown(text: string) {
  // Simple markdown: **bold** and newlines
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Handle newlines
    const lines = part.split("\n");
    return lines.map((line, j) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < lines.length - 1 && <br />}
      </span>
    ));
  });
}
