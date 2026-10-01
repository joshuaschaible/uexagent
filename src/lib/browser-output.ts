/** Keep spreadsheet exports as literal text, including headings from upstream data. */
function spreadsheetCell(value: string): string {
  const text = value.replace(/\{\{uex:[^}]+\}\}/g, "");
  // Spreadsheet apps can ignore leading whitespace before interpreting formulas.
  // Prefix text that could run a formula, including control-character prefixes.
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)
    ? `'${text}`
    : text;
}

export function tableToCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${spreadsheetCell(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

export function tableToTsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    // Embedded separators must not introduce an unprotected spreadsheet cell.
    .map((row) => row.map((cell) => spreadsheetCell(cell.replace(/[\t\r\n]+/g, " "))).join("\t"))
    .join("\n");
}

/** Chat images come from remote reference data, never relative or active URLs. */
export function safeImageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
