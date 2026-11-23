/**
 * JSON.parse keeps the LAST value of a duplicated key and drops the first
 * silently. In hand-curated data that hides edits (e.g. two "note" fields),
 * so the loader rejects duplicates. Returns "path.key" for each duplicate.
 */
export function findDuplicateKeys(text: string): string[] {
  const dupes: string[] = [];
  const stack: { keys: Set<string> | null; path: string; pendingKey?: string; index: number }[] = [];
  let i = 0;
  const readString = (): string => {
    let out = "";
    i++; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") {
        out += text[i] + text[i + 1];
        i += 2;
      } else out += text[i++];
    }
    i++; // closing quote
    return out;
  };
  const childPath = () => {
    const top = stack[stack.length - 1];
    if (!top) return "$";
    return top.keys ? `${top.path}.${top.pendingKey ?? "?"}` : `${top.path}[${top.index}]`;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const top = stack[stack.length - 1];
      const s = readString();
      // A string is a key if we are in an object and the next non-space char is ':'.
      let j = i;
      while (/\s/.test(text[j] ?? "")) j++;
      if (top?.keys && text[j] === ":") {
        if (top.keys.has(s)) dupes.push(`${top.path}.${s}`);
        top.keys.add(s);
        top.pendingKey = s;
      }
      continue;
    }
    if (ch === "{") stack.push({ keys: new Set(), path: childPath(), index: 0 });
    else if (ch === "[") stack.push({ keys: null, path: childPath(), index: 0 });
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top && !top.keys) top.index++;
    }
    i++;
  }
  return dupes;
}
