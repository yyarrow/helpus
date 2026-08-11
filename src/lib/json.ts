// Tolerant JSON extraction for LLM responses: accepts a bare JSON value,
// a fenced ```json block, or JSON followed by trailing prose.
// (classify.ts has its own private copy; unify when that file is next touched.)
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/g, "").trim();
  const start = unfenced.search(/[[{]/);
  if (start === -1) throw new Error("no JSON in model response");
  const attempts = [
    unfenced.slice(start),
    unfenced.slice(start, unfenced.lastIndexOf("]") + 1),
    unfenced.slice(start, unfenced.lastIndexOf("}") + 1),
  ];
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next, shorter slice
    }
  }
  throw new Error("unparseable JSON in model response");
}
