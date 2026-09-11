/** Bounded recovery for provider responses truncated at a JSON boundary. */
export function repairTruncatedJson(text) {
  const value = String(text ?? "").trim();
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  const attempt = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  const close = (prefix) => {
    const stack = [];
    let inString = false;
    let escaped = false;
    for (const character of prefix) {
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") stack.pop();
    }
    let repaired = prefix;
    if (inString) repaired += '"';
    repaired = repaired.replace(/,\s*$/u, "");
    for (const opener of stack.reverse()) repaired += opener === "{" ? "}" : "]";
    return attempt(repaired);
  };
  return close(value.slice(start)) ?? close(value.slice(start).replace(/,[^,]*$/u, ""));
}

export function extractJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const repaired = repairTruncatedJson(trimmed);
    if (repaired !== undefined) return repaired;
    for (let start = trimmed.indexOf("{"); start >= 0; start = trimmed.indexOf("{", start + 1)) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < trimmed.length; index += 1) {
        const character = trimmed[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === "{") depth += 1;
        else if (character === "}" && --depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
    throw new Error(`Response did not contain JSON: ${trimmed.slice(0, 200)}`);
  }
}
