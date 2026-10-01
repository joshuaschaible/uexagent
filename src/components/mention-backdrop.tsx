"use client";

import { useMemo } from "react";

type Mention = {
  value: string;
  type: string;
};

type MentionBackdropProps = {
  text: string;
  mentions: Mention[];
};

export function MentionBackdrop({ text, mentions }: MentionBackdropProps) {
  const segments = useMemo(() => {
    if (!text || mentions.length === 0) return null;

    // Find all mention positions in the text
    const positions: { start: number; end: number; type: string }[] = [];

    for (const mention of mentions) {
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const idx = text.indexOf(mention.value, searchFrom);
        if (idx === -1) break;
        positions.push({
          start: idx,
          end: idx + mention.value.length,
          type: mention.type,
        });
        searchFrom = idx + mention.value.length;
      }
    }

    if (positions.length === 0) return null;

    // Sort by position and remove overlaps
    positions.sort((a, b) => a.start - b.start);
    const merged: typeof positions = [positions[0]];
    for (let i = 1; i < positions.length; i++) {
      const prev = merged[merged.length - 1];
      if (positions[i].start >= prev.end) {
        merged.push(positions[i]);
      }
    }

    // Build segments: alternating plain text and mention spans
    const result: { text: string; type?: string }[] = [];
    let cursor = 0;

    for (const pos of merged) {
      if (cursor < pos.start) {
        result.push({ text: text.slice(cursor, pos.start) });
      }
      result.push({ text: text.slice(pos.start, pos.end), type: pos.type });
      cursor = pos.end;
    }

    if (cursor < text.length) {
      result.push({ text: text.slice(cursor) });
    }

    return result;
  }, [text, mentions]);

  if (!segments) {
    // No mentions — render all text in normal foreground color
    return (
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none text-sm whitespace-pre-wrap break-words overflow-hidden text-foreground"
      >
        {text}
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none text-sm whitespace-pre-wrap break-words overflow-hidden text-foreground"
    >
      {segments.map((seg, i) =>
        seg.type ? (
          <span
            key={i}
            className="entity-label rounded px-0.5 font-semibold"
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </div>
  );
}
