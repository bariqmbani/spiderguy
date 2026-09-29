// Citation validation for generated output: references must be retrieved chunks and quotes exact substrings.
export type Evidence = { chunk_id: string; source_id: string; revision_id: string; title: string; content: string; visibility: string };
export type RawCitation = { chunk_id: string; quote: string };
export type ValidCitation = { source_id: string; revision_id: string; chunk_id: string; quote: string; title: string };

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function validateCitations(citations: RawCitation[], evidence: Evidence[]): { ok: ValidCitation[]; errors: string[] } {
  const byId = new Map(evidence.map((e) => [e.chunk_id, e]));
  const ok: ValidCitation[] = [];
  const errors: string[] = [];
  for (const c of citations) {
    const e = byId.get(c.chunk_id);
    if (!e) {
      errors.push(`citation ${c.chunk_id} is not one of the provided passages`);
      continue;
    }
    if (!c.quote.trim() || !squash(e.content).includes(squash(c.quote))) {
      errors.push(`quote for ${c.chunk_id} is not an exact passage substring`);
      continue;
    }
    ok.push({ source_id: e.source_id, revision_id: e.revision_id, chunk_id: e.chunk_id, quote: c.quote.slice(0, 1000), title: e.title });
  }
  return { ok, errors };
}

/** Renders evidence as quoted data; retrieved text is never treated as instructions. */
export function renderEvidence(evidence: Evidence[], maxChars = 24000): string {
  let used = 0;
  const parts: string[] = [];
  for (const e of evidence) {
    const body = e.content.slice(0, Math.max(0, maxChars - used));
    if (!body) break;
    used += body.length;
    parts.push(`<passage chunk_id="${e.chunk_id}" title=${JSON.stringify(e.title)}>\n${body.replaceAll("</passage>", "</ passage>")}\n</passage>`);
  }
  return parts.join("\n\n");
}
