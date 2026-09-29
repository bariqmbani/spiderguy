// RFC 5322 plain-text draft builder. Header values are validated to prevent header injection.
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

export function encodeHeader(v: string): string {
  if (/[\r\n]/.test(v)) throw new Error("header values cannot contain line breaks");
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(new TextEncoder().encode(v))}?=`;
}

export function buildMime(p: { to: string[]; cc?: string[]; subject: string; body: string }): string {
  const body = b64(new TextEncoder().encode(p.body)).replace(/.{76}/g, "$&\r\n");
  return [
    `To: ${p.to.map(encodeHeader).join(", ")}`,
    ...(p.cc?.length ? [`Cc: ${p.cc.map(encodeHeader).join(", ")}`] : []),
    `Subject: ${encodeHeader(p.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}
