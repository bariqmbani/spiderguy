// Paragraph/heading chunker. Tokens are approximated as 4 characters (tokenizer "chars4-v1").
export const CHUNKER_VERSION = "para-v1/chars4-v1";
const CHARS_PER_TOKEN = 4;
const TARGET = 600 * CHARS_PER_TOKEN;
const MAX = 800 * CHARS_PER_TOKEN;
const OVERLAP = 100 * CHARS_PER_TOKEN;

export function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitLong(p: string): string[] {
  const out: string[] = [];
  let rest = p;
  while (rest.length > MAX) {
    let cut = rest.lastIndexOf(". ", TARGET);
    if (cut < TARGET / 2) cut = rest.lastIndexOf(" ", TARGET);
    if (cut < TARGET / 2) cut = TARGET;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(Math.max(cut + 1 - OVERLAP, 1)).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function chunkText(text: string): string[] {
  const paras = normalizeText(text).split(/\n\s*\n|\n(?=#{1,6}\s)/).map((p) => p.trim()).filter(Boolean).flatMap(splitLong);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > TARGET) {
      chunks.push(cur);
      const raw = cur.length > OVERLAP ? cur.slice(cur.length - OVERLAP) : "";
      const tail = raw.slice(raw.indexOf(" ") + 1).trim();
      cur = tail && tail.length + p.length + 2 <= MAX ? `${tail}\n\n${p}` : p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => c.slice(0, 8000));
}

export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
