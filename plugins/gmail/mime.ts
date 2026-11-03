import { randomUUID } from "node:crypto";
import PostalMime, {
  addressParser,
  decodeWords,
} from "./vendor/postal-mime/postal-mime.js";
import type {
  Address,
  Attachment,
  Email,
} from "./vendor/postal-mime/postal-mime.js";
export const fail = (code: string, status = 400): never => {
  throw Object.assign(Error(code), { code, status });
};
export function safeHeader(value: string): string {
  if (/[\r\n\x00]/.test(value)) return fail("unsupported_content");
  return value;
}
export function addresses(value: string | Address[] | undefined) {
  const parsed =
    typeof value === "string"
      ? addressParser(value, { flatten: true })
      : (value ?? []);
  return parsed
    .flatMap((a) => (a.group ? a.group : [a]))
    .map((a) => ({
      address: a.address,
      ...(a.name ? { name: decodeWords(a.name) } : {}),
    }));
}
export function headerMap(headers: { name: string; value: string }[] = []) {
  const result: Record<string, string> = Object.create(null);
  for (const h of headers) {
    const name = h.name.toLowerCase();
    result[name] = result[name] ? result[name] + ", " + h.value : h.value;
  }
  return result;
}
export const parse = async (raw: Buffer): Promise<Email> => {
  if (raw.length > 16 * 1024 * 1024) return fail("unsupported_content", 413);
  try {
    return await PostalMime.parse(raw, {
      forceRfc822Attachments: true,
      maxNestingDepth: 32,
      maxHeadersSize: 256 * 1024,
      maxPartCount: 1000,
    });
  } catch {
    return fail("unsupported_content");
  }
};
const word = (value: string) => {
  safeHeader(value);
  // Short encoded words can fold safely without breaking UTF-8 characters.
  const chunks: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (Buffer.byteLength(chunk + char) > 42) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((s) => "=?UTF-8?B?" + Buffer.from(s).toString("base64") + "?=")
    .join("\r\n ");
};
const base64 = (value: string | Buffer | Uint8Array | ArrayBuffer) =>
  Buffer.from(
    typeof value === "string" ? Buffer.from(value) : (value as Uint8Array),
  )
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") ?? "";
function mailbox(a: { address: string; name?: string }) {
  safeHeader(a.address);
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(a.address))
    return fail("unsupported_content");
  return (a.name ? word(a.name) + " " : "") + "<" + a.address + ">";
}
function multipart(kind: string, parts: string[]) {
  const boundary = "=_swb_" + randomUUID();
  return (
    `Content-Type: multipart/${kind}; boundary="${boundary}"\r\n\r\n` +
    parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("") +
    `--${boundary}--\r\n`
  );
}
function body(type: string, value: string) {
  return `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(value)}`;
}
export function compose(
  input: Record<string, any>,
  extras: {
    from?: { address: string; name?: string }[];
    replyTo?: { address: string; name?: string }[];
    attachments?: Attachment[];
    messageId?: string;
    inReplyTo?: string;
    references?: string;
  } = {},
) {
  const headers = ["MIME-Version: 1.0", "Date: " + new Date().toUTCString()];
  for (const [key, list] of Object.entries({
    From: extras.from,
    "Reply-To": extras.replyTo,
    To: input.to,
    Cc: input.cc,
    Bcc: input.bcc,
  }))
    if (list?.length)
      headers.push(key + ": " + list.map(mailbox).join(",\r\n "));
  if (input.subject !== undefined)
    headers.push("Subject: " + word(input.subject));
  for (const [key, value] of Object.entries({
    "Message-ID": extras.messageId,
    "In-Reply-To": extras.inReplyTo,
    References: extras.references,
  }))
    if (value) headers.push(key + ": " + safeHeader(value));
  const alternatives = [];
  if (input.text !== undefined)
    alternatives.push(body("text/plain", input.text));
  if (input.html !== undefined)
    alternatives.push(body("text/html", input.html));
  if (!alternatives.length) alternatives.push(body("text/plain", ""));
  let content =
    alternatives.length > 1
      ? multipart("alternative", alternatives)
      : alternatives[0];
  const related: string[] = [],
    attached: string[] = [];
  for (const a of extras.attachments ?? []) {
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(a.mimeType))
      return fail("unsupported_content");
    const name = encodeURIComponent(a.filename ?? "attachment").replace(
      /['()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16),
    );
    let type = a.mimeType;
    if (a.method) {
      if (!/^[A-Z]+$/.test(a.method)) return fail("unsupported_content");
      type += "; method=" + a.method;
    }
    const part =
      `Content-Type: ${type}\r\nContent-Disposition: ${a.related || a.disposition === "inline" ? "inline" : "attachment"}; filename*=utf-8''${name}\r\n` +
      (a.contentId ? "Content-ID: " + safeHeader(a.contentId) + "\r\n" : "") +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      base64(
        typeof a.content === "string"
          ? Buffer.from(a.content, a.encoding === "base64" ? "base64" : "utf8")
          : a.content,
      );
    (a.related ? related : attached).push(part);
  }
  if (related.length) content = multipart("related", [content, ...related]);
  if (attached.length) content = multipart("mixed", [content, ...attached]);
  const raw = Buffer.from(headers.join("\r\n") + "\r\n" + content);
  if (raw.length > 16 * 1024 * 1024) return fail("unsupported_content", 413);
  return raw.toString("base64url");
}
export { decodeWords };
