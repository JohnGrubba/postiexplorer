/** Top-level semicolon splitter shared by the mock backend and dump restore.
 *  Mirrors the Rust `split_statements` in `db.rs` for the common cases:
 *  dash-dash line comments, nested block comments, single-quoted strings,
 *  double-quoted identifiers and dollar quotes. Returns raw parts
 *  (trim/filter at the call site). */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") cur += sql[i++];
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      cur += "/*";
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          cur += "/*";
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          cur += "*/";
          i += 2;
        } else cur += sql[i++];
      }
      continue;
    }
    if (c === "'") {
      cur += c;
      i++;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      cur += c;
      i++;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const delim = m[0];
        cur += delim;
        i += delim.length;
        const end = sql.indexOf(delim, i);
        if (end === -1) {
          cur += sql.slice(i);
          i = n;
        } else {
          cur += sql.slice(i, end + delim.length);
          i = end + delim.length;
        }
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === ";") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur);
  return out;
}

/** True when a statement holds nothing but whitespace/comments/`;`. */
export function isEmptyStatement(s: string): boolean {
  const t = s
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/;/g, "")
    .trim();
  return t === "";
}

/** Split + drop empties, mirroring the backend batch semantics. */
export function splitBatch(sql: string): string[] {
  return splitStatements(sql).filter((s) => !isEmptyStatement(s));
}
