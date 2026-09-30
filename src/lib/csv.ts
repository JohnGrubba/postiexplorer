/** Minimal RFC-4180 CSV parser: handles quoted fields, `""` escapes,
 *  commas / CR / LF inside quotes, BOM, and CRLF line endings. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // True once any non-whitespace content was seen (guards empty input).
  let seen = false;
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        seen = true;
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      // A quote only opens a quoted field at the start of a field.
      if (field === "") {
        inQuotes = true;
        seen = true;
        i += 1;
      } else {
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r" && src[i + 1] === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 2;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    if (c.trim() !== "") seen = true;
    i += 1;
  }
  if (!seen && row.length === 0 && field === "") return [];
  row.push(field);
  // Drop a single trailing empty line produced by a final newline.
  const isTrailingEmpty = row.length === 1 && row[0] === "" && rows.length > 0;
  if (!isTrailingEmpty) rows.push(row);
  // Drop fully-empty rows (e.g. blank lines) but keep rows with empty cells
  // alongside real values.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** Map parsed CSV rows to table columns.
 *  With a header row, match by name (case-insensitive, trimmed); without,
 *  map positionally. Returns the ordered target column names plus data rows
 *  of cell strings aligned to those columns. */
export function mapCsvToColumns(
  parsed: string[][],
  tableColumns: string[],
  hasHeader: boolean,
): { columns: string[]; dataRows: string[][]; unmatched: string[] } {
  if (parsed.length === 0) return { columns: [], dataRows: [], unmatched: [] };
  const lower = new Map(tableColumns.map((c) => [c.toLowerCase(), c]));
  if (hasHeader) {
    const header = parsed[0].map((h) => h.trim());
    const unmatched: string[] = [];
    const colIdx: { target: string; csvIdx: number }[] = [];
    header.forEach((h, idx) => {
      const hit = lower.get(h.toLowerCase());
      if (hit) colIdx.push({ target: hit, csvIdx: idx });
      else if (h !== "") unmatched.push(h);
    });
    const columns = colIdx.map((c) => c.target);
    const dataRows = parsed.slice(1).map((r) => colIdx.map(({ csvIdx }) => (r[csvIdx] ?? "").trim()));
    return { columns, dataRows, unmatched };
  }
  const width = Math.min(parsed[0].length, tableColumns.length);
  const columns = tableColumns.slice(0, width);
  const dataRows = parsed.map((r) => r.slice(0, width).map((v) => v.trim()));
  return { columns, dataRows, unmatched: [] };
}
