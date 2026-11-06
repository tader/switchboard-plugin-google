import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  Connection,
  ContractContext,
  ContractDefinition,
  EmailMessage,
} from "./types/api.d.ts";
import { emailOperations } from "./email-schema.ts";
import { Cursors } from "./cursors.ts";
import {
  addresses,
  compose,
  decodeWords,
  fail,
  headerMap,
  parse,
} from "./mime.ts";
const ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPE = "https://www.googleapis.com/auth/gmail.";
const full = "https://mail.google.com/";
const segment = (v: unknown) => {
  if (typeof v !== "string" || !v || !/^[a-zA-Z0-9_-]+$/.test(v))
    return fail("invalid_request");
  return encodeURIComponent(v);
};
const query = (fields: Record<string, unknown>) =>
  "?" +
  new URLSearchParams(
    Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
async function request(
  ctx: ContractContext,
  path: string,
  method = "GET",
  body?: unknown,
) {
  // Only retry explicit provider throttling responses: transport failures and
  // ambiguous writes must keep their original uncertain outcome.
  const delays = [250, 500, 1000];
  let r: Response;
  let limited = false;
  for (let attempt = 0; ; attempt++) {
    ctx.signal.throwIfAborted();
    r = await ctx.request({
      url: ROOT + path,
      method,
      headers: [["content-type", "application/json"]],
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    ctx.signal.throwIfAborted();
    limited = r.status === 429;
    if (r.status === 403) {
      try {
        const data = await r.clone().json() as any;
        limited = Array.isArray(data?.error?.errors) && data.error.errors.some(
          (entry: any) => ["rateLimitExceeded", "userRateLimitExceeded"].includes(entry?.reason),
        );
      } catch { /* An unknown 403 is not safe to retry. */ }
    }
    if (!limited || attempt >= delays.length) break;
    const header = r.headers.get("retry-after");
    const seconds = header === null ? 0 : Number(header);
    const until = header && !Number.isFinite(seconds) ? Date.parse(header) : NaN;
    const requested = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000
      : Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
    // Never ignore a longer provider backoff just to make an in-band retry.
    if (requested > 3000) break;
    await sleep(Math.max(delays[attempt], requested), undefined, { signal: ctx.signal });
  }
  if (!r.ok) {
    const code = r.status === 401 ? "authentication_required"
      : limited ? "rate_limited"
      : r.status === 403 ? "permission_denied"
      : r.status === 404 ? "not_found"
      : r.status >= 500 ? "source_unavailable" : "invalid_request";
    const seconds = Number(r.headers.get("retry-after"));
    throw Object.assign(Error(code), {
      code,
      status: limited ? 429 : r.status,
      ...(limited ? { retryAfterMs: Number.isFinite(seconds) && seconds > 0
        ? Math.min(86400000, seconds * 1000) : 60000 } : {}),
    });
  }
  return r.status === 204 ? {} : r.json();
}
function grant(c: Connection) {
  const scopes = new Set(String(c.credentials.scope ?? "").split(/\s+/));
  const read =
    scopes.has(full) ||
    scopes.has(SCOPE + "readonly") ||
    scopes.has(SCOPE + "modify");
  const send =
    c.config.access !== "readonly" &&
    (scopes.has(full) ||
      scopes.has(SCOPE + "send") ||
      scopes.has(SCOPE + "modify"));
  const organize =
    !["readonly", "send"].includes(c.config.access) &&
    (scopes.has(full) || scopes.has(SCOPE + "modify"));
  const drafts =
    !["readonly", "send"].includes(c.config.access) &&
    (scopes.has(full) ||
      scopes.has(SCOPE + "modify") ||
      scopes.has(SCOPE + "compose"));
  return { read, send, organize, drafts };
}
// Gmail has no archive label: a message is archived when it is in All Mail but not
// in INBOX, SPAM, TRASH or DRAFT. This synthetic collection exposes that state with
// role "archive". Gmail system label IDs are fixed uppercase words and user labels are
// Label_*, so the ID cannot name a provider label; a provider label with this ID wins.
export const ARCHIVE = "ARCHIVE";
const UNARCHIVED = ["INBOX", "SPAM", "TRASH", "DRAFT"];
const ARCHIVE_QUERY = "-in:inbox -in:spam -in:trash -in:drafts";
export const archived = (labels: string[]) =>
  !labels.some((l) => UNARCHIVED.includes(l));
const iso = (v: unknown) => {
  const d = new Date(typeof v === "string" ? v : NaN);
  return Number.isFinite(d.valueOf()) ? d.toISOString() : null;
};
export function project(raw: any): EmailMessage {
  const headers = headerMap(raw.payload?.headers),
    labels: string[] = raw.labelIds ?? [];
  let text: string | undefined,
    html: string | undefined,
    attachments = false,
    unavailable = false,
    nodes = 0;
  function walk(part: any, depth = 0) {
    if (++nodes > 1000 || depth > 32) return fail("unsupported_content");
    if (
      part.filename ||
      (part.body?.attachmentId &&
        !["text/plain", "text/html"].includes(part.mimeType))
    ) {
      attachments = true;
      return;
    }
    if (
      [
        "multipart/encrypted",
        "application/pkcs7-mime",
        "application/x-pkcs7-mime",
      ].includes(part.mimeType)
    ) {
      unavailable = true;
      return;
    }
    if (["text/plain", "text/html"].includes(part.mimeType) && !part.filename) {
      if (part.body?.data !== undefined) {
        const mime = headerMap(part.headers)["content-type"] ?? "";
        const charset =
          /charset\s*=\s*"?([^;"\s]+)/i.exec(mime)?.[1] ?? "utf-8";
        let value: string;
        try {
          value = new TextDecoder(charset, { fatal: true }).decode(
            Buffer.from(part.body.data, "base64url"),
          );
        } catch {
          unavailable = true;
          return;
        }
        if (value.length > 524288) return fail("unsupported_content", 413);
        if (part.mimeType === "text/plain")
          text = text === undefined ? value : text + "\n" + value;
        else html = html === undefined ? value : html + "\n" + value;
      } else if (part.body?.attachmentId) unavailable = true;
    }
    for (const child of part.parts ?? []) walk(child, depth + 1);
  }
  if (raw.payload) walk(raw.payload);
  const available = !unavailable && (text !== undefined || html !== undefined);
  return {
    id: String(raw.id),
    ...(raw.historyId ? { version: String(raw.historyId) } : {}),
    subject: decodeWords(headers.subject ?? ""),
    from: addresses(headers.from),
    to: addresses(headers.to),
    ...(headers.cc ? { cc: addresses(headers.cc) } : {}),
    ...(headers.bcc ? { bcc: addresses(headers.bcc) } : {}),
    ...(headers["reply-to"] ? { replyTo: addresses(headers["reply-to"]) } : {}),
    collectionIds:
      archived(labels) && !labels.includes(ARCHIVE)
        ? [...labels, ARCHIVE]
        : labels,
    text: available ? (text ?? null) : null,
    ...(available && html !== undefined ? { html } : {}),
    contentState: available ? "available" : "unavailable",
    isRead: !labels.includes("UNREAD"),
    isFlagged: labels.includes("STARRED"),
    draft: labels.includes("DRAFT"),
    receivedAt: iso(
      Number.isFinite(Number(raw.internalDate))
        ? new Date(Number(raw.internalDate)).toISOString()
        : undefined,
    ),
    sentAt: iso(headers.date),
    ...(raw.threadId ? { threadId: raw.threadId } : {}),
    hasAttachments: unavailable ? null : attachments,
  };
}
export function createContracts(dataDir: string): ContractDefinition {
  const cursors = new Cursors(dataDir),
    operations: ContractDefinition["operations"] = {};
  const group = (name: string) =>
    name.endsWith(".list") || name.endsWith(".get")
      ? "read"
      : name.startsWith("email.drafts.")
        ? "drafts"
        : /\.(send|reply|forward)$/.test(name)
          ? "send"
          : "organize";
  const available = (c: Connection) =>
    Object.keys(operations).filter((n) => grant(c)[group(n)]);
  const op = (
    short: string,
    invoke: (
      input: Record<string, any>,
      ctx: ContractContext,
    ) => Promise<unknown>,
  ) => {
    const name = "email." + short,
      schema = structuredClone(emailOperations[name]);
    // Gmail offers no atomic if-match support for these APIs. Never pretend a prior read is a precondition.
    if (
      schema.inputSchema.properties &&
      typeof schema.inputSchema.properties === "object"
    )
      delete (schema.inputSchema.properties as any).ifVersion;
    operations[name] = {
      category: "email",
      readOnly: /\.(list|get)$/.test(name),
      ...schema,
      async invoke(input, ctx) {
        if (!available(ctx.connection).includes(name))
          return fail("permission_denied", 403);
        if (input.ifVersion !== undefined)
          return fail("unsupported_precondition");
        if (!/\.(list|get)$/.test(name) && !ctx.idempotencyKey)
          return fail("invalid_idempotency_key");
        try {
          return await invoke(input, ctx);
        } catch (e: any) {
          if (
            !/\.(list|get)$/.test(name) &&
            [
              "invalid_request",
              "unsupported_content",
              "not_found",
              "conflict",
              "permission_denied",
            ].includes(e.code)
          )
            return { status: "rejected", code: e.code };
          throw e;
        }
      },
    };
  };
  const binding = (
    ctx: ContractContext,
    kind: string,
    input: Record<string, any>,
  ) => [
    ctx.connection.id,
    ctx.connection.account?.id ?? null,
    kind,
    input.limit ?? 50,
    input.collectionId ?? null,
    input.isRead ?? null,
  ];
  const page = async (
    items: unknown[],
    next: string | undefined,
    bind: unknown,
    reason?: string,
  ) => ({
    items,
    ...(next ? { nextCursor: await cursors.encode(bind, next) } : {}),
    coverage: {
      complete: !next && !reason,
      ...(next || reason ? { reason: reason ?? "more_pages" } : {}),
    },
  });
  const hydrate = async (ctx: ContractContext, raw: any) => {
    let count = 0;
    async function walk(part: any, depth = 0): Promise<void> {
      if (++count > 1000 || depth > 32) return fail("unsupported_content");
      if (
        !part.filename &&
        ["text/plain", "text/html"].includes(part.mimeType) &&
        part.body?.attachmentId &&
        part.body.data === undefined &&
        part.body.size <= 524288
      ) {
        const body = await request(
          ctx,
          "/messages/" +
            segment(raw.id) +
            "/attachments/" +
            segment(part.body.attachmentId),
        );
        if (typeof body.data !== "string" || body.data.length > 700000)
          return fail("unsupported_content", 413);
        part.body = { ...part.body, data: body.data };
      }
      for (const child of part.parts ?? []) await walk(child, depth + 1);
    }
    if (raw.payload) await walk(raw.payload);
    return raw;
  };
  const get = async (ctx: ContractContext, id: unknown, format = "full") => {
    const raw = await request(
      ctx,
      "/messages/" + segment(id) + query({ format }),
    );
    return format === "full" ? hydrate(ctx, raw) : raw;
  };
  const rawMail = async (ctx: ContractContext, id: unknown) => {
    const raw = await get(ctx, id, "raw");
    if (typeof raw.raw !== "string" || raw.raw.length > 24 * 1024 * 1024)
      return fail("unsupported_content", 413);
    return { raw, parsed: await parse(Buffer.from(raw.raw, "base64url")) };
  };
  const profile = async (ctx: ContractContext) => {
    const data = await request(ctx, "/profile");
    return [{ address: data.emailAddress as string }];
  };
  const send = async (
    ctx: ContractContext,
    input: Record<string, any>,
    extras = {},
    threadId?: string,
  ) => {
    const raw = compose(input, { from: await profile(ctx), ...extras });
    const result = await request(ctx, "/messages/send", "POST", {
      raw,
      ...(threadId ? { threadId } : {}),
    });
    return { status: "accepted", resourceId: result.id };
  };
  op("mailboxes.list", async (input, ctx) => {
    const bind = binding(ctx, "mailboxes", input),
      offset = Number((await cursors.decode(bind, input.cursor)) ?? "0");
    if (!Number.isSafeInteger(offset) || offset < 0)
      return fail("invalid_cursor", 409);
    const data = await request(ctx, "/labels"),
      limit = input.limit ?? 50;
    const labels = data.labels ?? [];
    const synthetic = !labels.some((l: any) => l.id === ARCHIVE);
    const items = [
      ...labels,
      ...(synthetic ? [{ id: ARCHIVE, name: "Archive", archive: true }] : []),
    ].sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    const roles: Record<string, string> = {
      INBOX: "inbox",
      SENT: "sent",
      DRAFT: "drafts",
      TRASH: "trash",
      SPAM: "spam",
    };
    return page(
      items.slice(offset, offset + limit).map((l: any) => ({
        id: l.id,
        name: l.name,
        kind: "label",
        role: l.archive ? "archive" : (roles[l.id] ?? null),
        canWrite: grant(ctx.connection).organize,
      })),
      offset + limit < items.length ? String(offset + limit) : undefined,
      bind,
      "label_directory_snapshot",
    );
  });
  op("messages.get", async (input, ctx) => project(await get(ctx, input.id)));
  op("messages.list", async (input, ctx) => {
    const bind = binding(ctx, "messages", input),
      token = await cursors.decode(bind, input.cursor);
    // The archive collection is a search, unless the account really has such a label.
    const archive =
      input.collectionId === ARCHIVE &&
      !((await request(ctx, "/labels")).labels ?? []).some(
        (l: any) => l.id === ARCHIVE,
      );
    const q = [
      ...(archive ? [ARCHIVE_QUERY] : []),
      ...(input.isRead === undefined
        ? []
        : [input.isRead ? "is:read" : "is:unread"]),
    ].join(" ");
    const data = await request(
      ctx,
      "/messages" +
        query({
          maxResults: input.limit ?? 50,
          pageToken: token,
          labelIds: archive ? undefined : input.collectionId,
          q: q || undefined,
          includeSpamTrash: true,
        }),
    );
    const items = [];
    let missing = false;
    for (const m of data.messages ?? []) {
      try {
        const message = project(await get(ctx, m.id));
        // Labels may change between the search and the read; never list a message outside the collection.
        if (archive && !message.collectionIds.includes(ARCHIVE)) missing = true;
        else items.push(message);
      } catch (e: any) {
        if (e.code !== "not_found") throw e;
        missing = true;
      }
    }
    return page(
      items,
      data.nextPageToken,
      bind,
      missing ? "snapshot_changed" : undefined,
    );
  });
  op("messages.update", async (input, ctx) => {
    const addLabelIds: string[] = [],
      removeLabelIds: string[] = [];
    for (const [key, label, inverted] of [
      ["isRead", "UNREAD", true],
      ["isFlagged", "STARRED", false],
    ] as const)
      if (input.changes[key] !== undefined)
        (input.changes[key] !== inverted ? addLabelIds : removeLabelIds).push(
          label,
        );
    const r = await request(
      ctx,
      "/messages/" + segment(input.id) + "/modify",
      "POST",
      { addLabelIds, removeLabelIds },
    );
    return { status: "accepted", resourceId: r.id };
  });
  op("messages.move", async (input, ctx) => {
    const labels = await request(ctx, "/labels"),
      all = new Set((labels.labels ?? []).map((l: any) => l.id));
    if (
      !all.has(ARCHIVE) &&
      [input.destinationId, input.sourceCollectionId].includes(ARCHIVE)
    ) {
      // Archive removes only INBOX; unarchive adds INBOX (or SPAM). Other labels stay.
      const toArchive = input.destinationId === ARCHIVE;
      if (
        toArchive
          ? ![undefined, "INBOX"].includes(input.sourceCollectionId)
          : !["INBOX", "SPAM"].includes(input.destinationId)
      )
        return fail("invalid_request");
      // Archiving cannot take a message out of spam, trash or drafts.
      const current = await get(ctx, input.id, "minimal"),
        state: string[] = current.labelIds ?? [];
      if (
        toArchive
          ? ["SPAM", "TRASH", "DRAFT"].some((l) => state.includes(l))
          : !archived(state)
      )
        return fail(toArchive ? "invalid_request" : "conflict");
      const r = await request(
        ctx,
        "/messages/" + segment(input.id) + "/modify",
        "POST",
        toArchive
          ? { addLabelIds: [], removeLabelIds: ["INBOX"] }
          : { addLabelIds: [input.destinationId], removeLabelIds: [] },
      );
      return { status: "accepted", resourceId: r.id };
    }
    if (
      !all.has(input.destinationId) ||
      (input.sourceCollectionId && !all.has(input.sourceCollectionId)) ||
      input.destinationId === input.sourceCollectionId
    )
      return fail("invalid_request");
    // Trash has its own operation; immutable/system state labels are not destinations.
    const writable = (id: string) =>
      id === "INBOX" || id === "SPAM" || id.startsWith("Label_");
    if (
      !writable(input.destinationId) ||
      (input.sourceCollectionId && !writable(input.sourceCollectionId))
    )
      return fail("invalid_request");
    const r = await request(
      ctx,
      "/messages/" + segment(input.id) + "/modify",
      "POST",
      {
        addLabelIds: [input.destinationId],
        removeLabelIds: input.sourceCollectionId
          ? [input.sourceCollectionId]
          : [],
      },
    );
    return { status: "accepted", resourceId: r.id };
  });
  op("messages.trash", async (input, ctx) => {
    const r = await request(
      ctx,
      "/messages/" + segment(input.id) + "/trash",
      "POST",
      {},
    );
    return { status: "accepted", resourceId: r.id };
  });
  op("messages.send", (input, ctx) => send(ctx, input));
  op("messages.reply", async (input, ctx) => {
    const { raw, parsed } = await rawMail(ctx, input.id),
      own = await profile(ctx),
      self = own[0].address.toLowerCase();
    if (!parsed.messageId) return fail("unsupported_content");
    const recipients = addresses(
      parsed.replyTo?.length
        ? parsed.replyTo
        : parsed.from
          ? [parsed.from]
          : undefined,
    );
    const to = recipients.filter((a) => a.address.toLowerCase() !== self);
    if (!to.length)
      to.push(
        ...addresses(parsed.to).filter((a) => a.address.toLowerCase() !== self),
      );
    const cc = input.replyAll
      ? addresses([...(parsed.to ?? []), ...(parsed.cc ?? [])]).filter(
          (a) =>
            a.address.toLowerCase() !== self &&
            !to.some(
              (t) => t.address.toLowerCase() === a.address.toLowerCase(),
            ),
        )
      : [];
    if (!to.length) return fail("invalid_request");
    const subject = /^re:/i.test(parsed.subject ?? "")
      ? parsed.subject
      : "Re: " + (parsed.subject ?? "");
    return send(
      ctx,
      { ...input, subject, to, cc },
      {
        inReplyTo: parsed.messageId,
        references: [parsed.references, parsed.messageId]
          .filter(Boolean)
          .join(" "),
      },
      raw.threadId,
    );
  });
  op("messages.forward", async (input, ctx) => {
    const { parsed } = await rawMail(ctx, input.id);
    const heading =
      "\n\n---------- Forwarded message ----------\nFrom: " +
      addresses(parsed.from ? [parsed.from] : undefined)
        .map((a) => a.address)
        .join(", ") +
      "\nSubject: " +
      (parsed.subject ?? "") +
      "\n\n";
    const escape = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      );
    return send(
      ctx,
      {
        ...input,
        subject: /^fwd:/i.test(parsed.subject ?? "")
          ? parsed.subject
          : "Fwd: " + (parsed.subject ?? ""),
        ...(input.text !== undefined
          ? { text: input.text + heading + (parsed.text ?? "") }
          : {}),
        ...(input.html !== undefined
          ? {
              html:
                input.html +
                "<blockquote><pre>" +
                escape(heading) +
                "</pre>" +
                (parsed.html ??
                  "<pre>" + escape(parsed.text ?? "") + "</pre>") +
                "</blockquote>",
            }
          : {}),
      },
      { attachments: parsed.attachments },
    );
  });
  const draft = async (ctx: ContractContext, id: unknown) => {
    const r = await request(ctx, "/drafts/" + segment(id) + "?format=full");
    if (!r.message?.labelIds?.includes("DRAFT")) return fail("not_found", 404);
    return { id: r.id, message: project(await hydrate(ctx, r.message)) };
  };
  op("drafts.get", (input, ctx) => draft(ctx, input.id));
  op("drafts.list", async (input, ctx) => {
    const bind = binding(ctx, "drafts", input),
      token = await cursors.decode(bind, input.cursor);
    const data = await request(
      ctx,
      "/drafts" + query({ maxResults: input.limit ?? 50, pageToken: token }),
    );
    const items = [];
    let missing = false;
    for (const d of data.drafts ?? [])
      try {
        items.push(await draft(ctx, d.id));
      } catch (e: any) {
        if (e.code !== "not_found") throw e;
        missing = true;
      }
    return page(
      items,
      data.nextPageToken,
      bind,
      missing ? "snapshot_changed" : undefined,
    );
  });
  op("drafts.create", async (input, ctx) => {
    const raw = compose(input, { from: await profile(ctx) }),
      r = await request(ctx, "/drafts", "POST", { message: { raw } });
    return { status: "accepted", resourceId: r.id };
  });
  op("drafts.update", async (input, ctx) => {
    const d = await request(
      ctx,
      "/drafts/" + segment(input.id) + "?format=raw",
    );
    if (
      !d.message?.labelIds?.includes("DRAFT") ||
      typeof d.message.raw !== "string"
    )
      return fail("not_found", 404);
    if (d.message.raw.length > 24 * 1024 * 1024)
      return fail("unsupported_content", 413);
    const p = await parse(Buffer.from(d.message.raw, "base64url"));
    const type =
      p.headers.find((h) => h.key === "content-type")?.value ?? "text/plain";
    if (
      /multipart\/(signed|encrypted)|application\/(x-)?pkcs7-mime/i.test(type)
    )
      return fail("unsupported_content");
    const merged = {
      subject: p.subject ?? "",
      to: addresses(p.to),
      cc: addresses(p.cc),
      bcc: addresses(p.bcc),
      ...(p.text !== undefined ? { text: p.text } : {}),
      ...(p.html !== undefined ? { html: p.html } : {}),
      ...input.changes,
    };
    const raw = compose(merged, {
      from: p.from ? addresses([p.from]) : await profile(ctx),
      replyTo: addresses(p.replyTo),
      attachments: p.attachments,
      messageId: p.messageId,
      inReplyTo: p.inReplyTo,
      references: p.references,
    });
    const r = await request(ctx, "/drafts/" + segment(input.id), "PUT", {
      message: {
        raw,
        ...(d.message.threadId ? { threadId: d.message.threadId } : {}),
      },
    });
    return { status: "accepted", resourceId: r.id };
  });
  op("drafts.delete", async (input, ctx) => {
    await draft(ctx, input.id);
    await request(ctx, "/drafts/" + segment(input.id), "DELETE");
    return { status: "accepted", resourceId: input.id };
  });
  op("drafts.send", async (input, ctx) => {
    const d = await draft(ctx, input.id);
    if (
      ![...d.message.to, ...(d.message.cc ?? []), ...(d.message.bcc ?? [])]
        .length
    )
      return fail("invalid_request");
    const r = await request(ctx, "/drafts/send", "POST", { id: input.id });
    return { status: "accepted", resourceId: r.id };
  });
  return {
    version: 1,
    operations,
    available,
    async collect(_input, ctx) {
      await request(ctx, "/profile");
      const checkpoint = randomUUID();
      return {
        checkpoint,
        events: [
          {
            sourceId: "gmail-reconcile:" + checkpoint,
            event: {
              category: "email",
              type: "invalidated",
              resourceType: "scope",
            },
          },
        ],
      };
    },
  };
}
