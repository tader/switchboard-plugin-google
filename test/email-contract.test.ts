import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Ajv } from "ajv";
import { createContracts, project } from "../plugins/gmail/contracts.ts";
import { compose, parse } from "../plugins/gmail/mime.ts";
import type {
  ContractContext,
  ContractRequest,
} from "../plugins/gmail/types/api.d.ts";
const ajv = new Ajv({ strict: false });
const response = (body: unknown, status = 200, headers = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
async function fixture(
  t: any,
  respond: (r: ContractRequest) => Response | Promise<Response>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gmail-contract-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const contracts = createContracts(root),
    requests: ContractRequest[] = [];
  const ctx: ContractContext = {
    connection: {
      id: "connection",
      account: { id: "account" },
      config: { access: "modify" },
      credentials: { scope: "https://www.googleapis.com/auth/gmail.modify" },
    } as any,
    signal: new AbortController().signal,
    idempotencyKey: "fixture-key",
    async request(r) {
      requests.push(r);
      return respond(r);
    },
  };
  async function call(name: string, args: Record<string, unknown> = {}) {
    const op = contracts.operations["email." + name];
    assert.ok(ajv.validate(op.inputSchema, args), ajv.errorsText());
    const result = await op.invoke(args, ctx);
    assert.ok(ajv.validate(op.outputSchema, result), ajv.errorsText());
    return result as any;
  }
  return { root, contracts, ctx, call, requests };
}
const textMessage = (id = "m1") => ({
  id,
  threadId: "thread",
  historyId: "12",
  labelIds: ["INBOX", "UNREAD"],
  internalDate: "1793746800000",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "Subject", value: "=?UTF-8?B?R3LDvMOfZQ==?=" },
      { name: "From", value: '"Person, Example" <person@example.test>' },
      { name: "To", value: "self@example.test" },
    ],
    body: { data: Buffer.from("Hello").toString("base64url") },
  },
});
const original = () =>
  compose(
    {
      subject: "Résumé",
      to: [{ address: "person@example.test", name: "Person, Example" }],
      cc: [{ address: "cc@example.test" }],
      bcc: [{ address: "private@example.test" }],
      text: "Original body",
      html: '<p>Original <img src="cid:image"></p>',
    },
    {
      from: [{ address: "self@example.test" }],
      messageId: "<draft@example.test>",
      inReplyTo: "<parent@example.test>",
      references: "<root@example.test>",
      attachments: [
        {
          filename: "bijlage.bin",
          mimeType: "application/octet-stream",
          disposition: "attachment",
          content: new Uint8Array([0, 1, 255]),
        },
        {
          filename: "image.png",
          mimeType: "image/png",
          disposition: "inline",
          related: true,
          contentId: "<image>",
          content: new Uint8Array([4, 5, 6]),
        },
      ],
    },
  );
test("Gmail advertises effective grants and explicit binding access", async (t) => {
  const f = await fixture(t, () => response({}));
  assert.equal(f.contracts.available(f.ctx.connection).length, 15);
  f.ctx.connection.config.access = "readonly";
  assert.deepEqual(f.contracts.available(f.ctx.connection), [
    "email.mailboxes.list",
    "email.messages.get",
    "email.messages.list",
    "email.drafts.get",
    "email.drafts.list",
  ]);
  const denied = await f.contracts.operations["email.messages.send"]
    .invoke({ to: [], subject: "", text: "" }, f.ctx)
    .catch((e) => e);
  assert.equal(denied.code, "permission_denied");
  assert.equal(f.requests.length, 0);
  f.ctx.connection.config.access = "send";
  f.ctx.connection.credentials.scope =
    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
  const names = f.contracts.available(f.ctx.connection);
  assert.ok(names.includes("email.messages.reply"));
  assert.ok(!names.includes("email.drafts.create"));
  assert.ok(!names.includes("email.messages.trash"));
  f.ctx.connection.credentials.scope = "";
  assert.deepEqual(f.contracts.available(f.ctx.connection), []);
});
test("Gmail projections decode structured headers and charset while preserving unavailable content", () => {
  const r = project(textMessage());
  assert.equal(r.subject, "Grüße");
  assert.deepEqual(r.from, [
    { address: "person@example.test", name: "Person, Example" },
  ]);
  assert.equal(r.text, "Hello");
  assert.equal(r.isRead, false);
  const raw = textMessage() as any;
  raw.payload = {
    mimeType: "multipart/mixed",
    headers: raw.payload.headers,
    parts: [
      {
        mimeType: "text/plain",
        headers: [
          { name: "Content-Type", value: "text/plain; charset=windows-1252" },
        ],
        body: { data: Buffer.from([0x80]).toString("base64url") },
      },
      {
        mimeType: "application/pdf",
        filename: "report.pdf",
        body: { attachmentId: "a" },
      },
    ],
  };
  const p = project(raw);
  assert.equal(p.text, "€");
  assert.equal(p.hasAttachments, true);
  raw.payload = { mimeType: "application/pkcs7-mime", headers: [] };
  const encrypted = project(raw);
  assert.equal(encrypted.contentState, "unavailable");
  assert.equal(encrypted.text, null);
  assert.equal(encrypted.hasAttachments, null);
});
test("MIME roundtrip retains Unicode, binary attachments and inline content ids without header injection", async () => {
  const p = await parse(Buffer.from(original(), "base64url"));
  assert.equal(p.subject, "Résumé");
  assert.equal(p.to?.[0].name, "Person, Example");
  assert.equal(p.text?.trim(), "Original body");
  assert.equal(p.attachments.length, 2);
  assert.deepEqual(
    Buffer.from(
      p.attachments.find((a) => a.filename === "bijlage.bin")!
        .content as ArrayBuffer,
    ),
    Buffer.from([0, 1, 255]),
  );
  assert.equal(
    p.attachments.find((a) => a.contentId === "<image>")?.related,
    true,
  );
  assert.throws(
    () => compose({ subject: "Hello\r\nBcc: stranger@example.test", text: "" }),
    { code: "unsupported_content" },
  );
  assert.throws(
    () => compose({ to: [{ address: "bad@example.test\n" }], text: "" }),
    { code: "unsupported_content" },
  );
});
test("history cursors are signed, query/account bound and survive adapter restart", async (t) => {
  const f = await fixture(t, (r) =>
    new URL(r.url).pathname.endsWith("/messages")
      ? response({
          messages: [{ id: "m1" }],
          nextPageToken: "next-provider-page",
        })
      : response(textMessage()),
  );
  const first = await f.call("messages.list", { limit: 1, isRead: false });
  assert.equal(first.coverage.complete, false);
  assert.equal(first.items[0].text, "Hello");
  const same = createContracts(f.root);
  await same.operations["email.messages.list"].invoke(
    { limit: 1, isRead: false, cursor: first.nextCursor },
    f.ctx,
  );
  assert.equal(
    new URL(f.requests[2].url).searchParams.get("pageToken"),
    "next-provider-page",
  );
  await assert.rejects(
    () =>
      f.call("messages.list", {
        limit: 1,
        isRead: true,
        cursor: first.nextCursor,
      }),
    { code: "invalid_cursor" },
  );
  f.ctx.connection.account!.id = "other";
  await assert.rejects(
    () =>
      f.call("messages.list", {
        limit: 1,
        isRead: false,
        cursor: first.nextCursor,
      }),
    { code: "invalid_cursor" },
  );
  f.ctx.connection.account!.id = "account";
  const parts = first.nextCursor.split(".");
  parts[0] = Buffer.from(JSON.stringify(["forged", "elsewhere"])).toString(
    "base64url",
  );
  await assert.rejects(
    () =>
      f.call("messages.list", {
        limit: 1,
        isRead: false,
        cursor: parts.join("."),
      }),
    { code: "invalid_cursor" },
  );
});
test("draft patch preserves attachments, threading and unspecified fields, and clears supplied recipients", async (t) => {
  let uploaded: any;
  const f = await fixture(t, (r) => {
    if (r.url.endsWith("/profile"))
      return response({ emailAddress: "self@example.test" });
    if (r.method === "PUT") {
      uploaded = JSON.parse(String(r.body));
      return response({ id: "draft" });
    }
    return response({
      id: "draft",
      message: {
        id: "message",
        threadId: "thread",
        labelIds: ["DRAFT"],
        raw: original(),
      },
    });
  });
  const result = await f.call("drafts.update", {
    id: "draft",
    changes: { subject: "Changed", to: [] },
  });
  assert.equal(result.status, "accepted");
  assert.equal(uploaded.message.threadId, "thread");
  const p = await parse(Buffer.from(uploaded.message.raw, "base64url"));
  assert.equal(p.subject, "Changed");
  assert.equal(p.to?.length ?? 0, 0);
  assert.equal(p.bcc?.[0].address, "private@example.test");
  assert.equal(p.attachments.length, 2);
  assert.equal(p.inReplyTo, "<parent@example.test>");
  assert.equal(p.references, "<root@example.test>");
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, 1);
});
test("reply uses exact native thread and recipients, never inherits Bcc", async (t) => {
  let uploaded: any;
  const incoming = compose(
    {
      subject: "Topic",
      to: [{ address: "self@example.test" }],
      cc: [{ address: "cc@example.test" }],
      bcc: [{ address: "hidden@example.test" }],
      text: "Original",
    },
    {
      from: [{ address: "sender@example.test" }],
      messageId: "<incoming@example.test>",
      references: "<root@example.test>",
    },
  );
  const f = await fixture(t, (r) => {
    if (r.url.endsWith("/profile"))
      return response({ emailAddress: "self@example.test" });
    if (r.method === "POST") {
      uploaded = JSON.parse(String(r.body));
      return response({ id: "sent" });
    }
    return response({ id: "source", threadId: "exact-thread", raw: incoming });
  });
  await f.call("messages.reply", {
    id: "source",
    text: "Response",
    replyAll: true,
  });
  const p = await parse(Buffer.from(uploaded.raw, "base64url"));
  assert.equal(uploaded.threadId, "exact-thread");
  assert.equal(p.to?.[0].address, "sender@example.test");
  assert.equal(p.cc?.[0].address, "cc@example.test");
  assert.equal(p.bcc, undefined);
  assert.equal(p.inReplyTo, "<incoming@example.test>");
  assert.equal(p.subject, "Re: Topic");
});
test("forward retains original attachments and quotes without disclosing original Bcc", async (t) => {
  let uploaded: any;
  const f = await fixture(t, (r) => {
    if (r.url.endsWith("/profile"))
      return response({ emailAddress: "self@example.test" });
    if (r.method === "POST") {
      uploaded = JSON.parse(String(r.body));
      return response({ id: "sent" });
    }
    return response({ raw: original() });
  });
  await f.call("messages.forward", {
    id: "m",
    to: [{ address: "next@example.test" }],
    text: "See below",
    html: "<p>See below</p>",
  });
  const p = await parse(Buffer.from(uploaded.raw, "base64url"));
  assert.equal(p.to?.[0].address, "next@example.test");
  assert.equal(p.bcc, undefined);
  assert.equal(p.attachments.length, 2);
  assert.ok(p.text?.includes("Original body"));
  assert.ok(p.html?.includes("cid:image"));
  assert.equal(uploaded.threadId, undefined);
});
test("organization only changes requested labels and rejects unsupported atomic preconditions", async (t) => {
  const f = await fixture(t, (r) =>
    r.url.endsWith("/labels")
      ? response({ labels: [{ id: "INBOX" }, { id: "Label_work" }] })
      : response({ id: "m" }),
  );
  await f.call("messages.update", {
    id: "m",
    changes: { isRead: true, isFlagged: true },
  });
  assert.deepEqual(JSON.parse(String(f.requests[0].body)), {
    addLabelIds: ["STARRED"],
    removeLabelIds: ["UNREAD"],
  });
  await f.call("messages.move", {
    id: "m",
    destinationId: "Label_work",
    sourceCollectionId: "INBOX",
  });
  assert.deepEqual(JSON.parse(String(f.requests.at(-1)!.body)), {
    addLabelIds: ["Label_work"],
    removeLabelIds: ["INBOX"],
  });
  assert.equal(
    ajv.validate(f.contracts.operations["email.messages.update"].inputSchema, {
      id: "m",
      ifVersion: "old",
      changes: { isRead: true },
    }),
    false,
  );
  await assert.rejects(
    () =>
      f.contracts.operations["email.messages.update"].invoke(
        { id: "m", ifVersion: "old", changes: { isRead: true } },
        f.ctx,
      ),
    { code: "unsupported_precondition" },
  );
});
test("auth expiry and provider backoff stay typed; resource denial is not global auth failure", async (t) => {
  let status = 401;
  const f = await fixture(t, () =>
    response({ error: { message: "private upstream details" } }, status, {
      "retry-after": "120",
    }),
  );
  await assert.rejects(() => f.call("messages.get", { id: "m" }), {
    code: "authentication_required",
  });
  status = 403;
  await assert.rejects(() => f.call("messages.get", { id: "m" }), {
    code: "permission_denied",
  });
  status = 429;
  await assert.rejects(
    () => f.call("messages.get", { id: "m" }),
    (e) =>
      (e as any).code === "rate_limited" &&
      (e as any).retryAfterMs === 120000 &&
      !String(e).includes("private upstream details"),
  );
});

test("large textual MIME body references are hydrated without reading ordinary attachments", async (t) => {
  const raw = textMessage() as any;
  raw.payload.body = { size: 12, attachmentId: "textPart" };
  const f = await fixture(t, (r) =>
    r.url.includes("/attachments/textPart")
      ? response({ data: Buffer.from("Hydrated body").toString("base64url") })
      : response(raw),
  );
  const m = await f.call("messages.get", { id: "m1" });
  assert.equal(m.text, "Hydrated body");
  assert.equal(f.requests.length, 2);
});

test("signed draft edits fail before any provider write and aliases/Reply-To survive ordinary edits", async (t) => {
  let signed = true,
    uploaded: any;
  const raw = compose(
    {
      subject: "Alias draft",
      to: [{ address: "recipient@example.test" }],
      text: "Body",
    },
    {
      from: [{ address: "alias@example.test" }],
      replyTo: [{ address: "reply@example.test" }],
    },
  );
  const f = await fixture(t, (r) => {
    if (r.method === "PUT") {
      uploaded = JSON.parse(String(r.body));
      return response({ id: "d" });
    }
    const source = signed
      ? Buffer.from(
          'MIME-Version: 1.0\r\nContent-Type: multipart/signed; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nBody\r\n--x--\r\n',
        ).toString("base64url")
      : raw;
    return response({
      id: "d",
      message: { id: "m", labelIds: ["DRAFT"], raw: source },
    });
  });
  const rejected = await f.call("drafts.update", {
    id: "d",
    changes: { subject: "Changed" },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.code, "unsupported_content");
  assert.equal(f.requests.filter((r) => r.method !== "GET").length, 0);
  signed = false;
  await f.call("drafts.update", { id: "d", changes: { subject: "Changed" } });
  const p = await parse(Buffer.from(uploaded.message.raw, "base64url"));
  assert.equal(p.from?.address, "alias@example.test");
  assert.equal(p.replyTo?.[0].address, "reply@example.test");
});
test("Gmail lists a writable archive collection with role archive, never a virtual one", async (t) => {
  const f = await fixture(t, () =>
    response({
      labels: [
        { id: "INBOX", name: "INBOX" },
        { id: "SENT", name: "SENT" },
        // A user label named "Archive" is an ordinary label, not the archive role.
        { id: "Label_7", name: "Archive" },
      ],
    }),
  );
  const result = await f.call("mailboxes.list", {});
  const archive = result.items.filter((m: any) => m.role === "archive");
  assert.deepEqual(archive, [
    {
      id: "ARCHIVE",
      name: "Archive",
      kind: "label",
      role: "archive",
      canWrite: true,
    },
  ]);
  assert.equal(result.items.find((m: any) => m.id === "Label_7").role, null);
  f.ctx.connection.config.access = "readonly";
  f.ctx.connection.credentials.scope =
    "https://www.googleapis.com/auth/gmail.readonly";
  const readonly = await f.call("mailboxes.list", {});
  assert.equal(
    readonly.items.find((m: any) => m.id === "ARCHIVE").canWrite,
    false,
  );
});

test("Gmail projections add the archive collection only outside inbox, spam, trash and drafts", () => {
  const labels = (labelIds: string[]) =>
    project({ ...textMessage(), labelIds }).collectionIds;
  assert.deepEqual(labels(["Label_work", "IMPORTANT"]), [
    "Label_work",
    "IMPORTANT",
    "ARCHIVE",
  ]);
  assert.deepEqual(labels(["SENT"]), ["SENT", "ARCHIVE"]);
  for (const state of ["INBOX", "SPAM", "TRASH", "DRAFT"])
    assert.ok(!labels([state, "Label_work"]).includes("ARCHIVE"), state);
});

test("archive move removes only INBOX and keeps every other label", async (t) => {
  let labelIds = ["INBOX", "UNREAD", "STARRED", "Label_work", "IMPORTANT"];
  const f = await fixture(t, (r) => {
    const u = new URL(r.url);
    if (u.pathname.endsWith("/labels"))
      return response({ labels: [{ id: "INBOX" }, { id: "Label_work" }] });
    if (u.pathname.endsWith("/modify")) {
      const body = JSON.parse(String(r.body));
      labelIds = labelIds
        .filter((l) => !body.removeLabelIds.includes(l))
        .concat(body.addLabelIds);
      return response({ id: "m", labelIds });
    }
    return response({ ...textMessage("m"), labelIds });
  });
  for (const args of [
    { id: "m", destinationId: "ARCHIVE", sourceCollectionId: "INBOX" },
    { id: "m", destinationId: "ARCHIVE" },
  ]) {
    labelIds = ["INBOX", "UNREAD", "STARRED", "Label_work", "IMPORTANT"];
    assert.deepEqual(await f.call("messages.move", args), {
      status: "accepted",
      resourceId: "m",
    });
    assert.deepEqual(JSON.parse(String(f.requests.at(-1)!.body)), {
      addLabelIds: [],
      removeLabelIds: ["INBOX"],
    });
    assert.equal(
      new URL(f.requests.at(-2)!.url).searchParams.get("format"),
      "minimal",
    );
  }
  const after = await f.call("messages.get", { id: "m" });
  assert.deepEqual(after.collectionIds, [
    "UNREAD",
    "STARRED",
    "Label_work",
    "IMPORTANT",
    "ARCHIVE",
  ]);
  assert.equal(after.isFlagged, true);
  assert.equal(after.isRead, false);
  // Unarchive from the archive collection adds INBOX back and removes nothing.
  await f.call("messages.move", {
    id: "m",
    destinationId: "INBOX",
    sourceCollectionId: "ARCHIVE",
  });
  assert.deepEqual(JSON.parse(String(f.requests.at(-1)!.body)), {
    addLabelIds: ["INBOX"],
    removeLabelIds: [],
  });
  assert.ok(
    !(await f.call("messages.get", { id: "m" })).collectionIds.includes(
      "ARCHIVE",
    ),
  );
});

test("archive moves reject impossible combinations before any provider write", async (t) => {
  let labelIds = ["TRASH", "Label_work"];
  const f = await fixture(t, (r) =>
    new URL(r.url).pathname.endsWith("/labels")
      ? response({ labels: [{ id: "INBOX" }, { id: "Label_work" }] })
      : response({ id: "m", labelIds }),
  );
  const rejected = { status: "rejected", code: "invalid_request" };
  // Removing a user label while archiving is not "remove only the source".
  assert.deepEqual(
    await f.call("messages.move", {
      id: "m",
      destinationId: "ARCHIVE",
      sourceCollectionId: "Label_work",
    }),
    rejected,
  );
  // Leaving the archive for a user label would keep the message archived.
  assert.deepEqual(
    await f.call("messages.move", {
      id: "m",
      destinationId: "Label_work",
      sourceCollectionId: "ARCHIVE",
    }),
    rejected,
  );
  assert.deepEqual(
    await f.call("messages.move", {
      id: "m",
      destinationId: "ARCHIVE",
      sourceCollectionId: "ARCHIVE",
    }),
    rejected,
  );
  // Trash, spam and drafts are never archived by removing INBOX.
  for (const state of ["TRASH", "SPAM", "DRAFT"]) {
    labelIds = [state, "INBOX"];
    assert.deepEqual(
      await f.call("messages.move", { id: "m", destinationId: "ARCHIVE" }),
      rejected,
    );
  }
  // Unarchiving a message that is not archived is a conflict, not a silent label add.
  labelIds = ["INBOX"];
  assert.deepEqual(
    await f.call("messages.move", {
      id: "m",
      destinationId: "INBOX",
      sourceCollectionId: "ARCHIVE",
    }),
    { status: "rejected", code: "conflict" },
  );
  assert.ok(f.requests.every((r) => !r.url.endsWith("/modify")));
});

test("archive listing searches outside inbox/spam/trash/drafts and drops messages that changed", async (t) => {
  const f = await fixture(t, (r) => {
    const u = new URL(r.url);
    if (u.pathname.endsWith("/labels"))
      return response({ labels: [{ id: "INBOX" }] });
    if (u.pathname.endsWith("/messages"))
      return response({ messages: [{ id: "a" }, { id: "b" }] });
    return response({
      ...textMessage(u.pathname.split("/").pop()),
      labelIds: u.pathname.endsWith("/a") ? ["Label_work"] : ["INBOX"],
    });
  });
  const result = await f.call("messages.list", {
    collectionId: "ARCHIVE",
    isRead: false,
  });
  const search = new URL(
    f.requests.find((r) => new URL(r.url).pathname.endsWith("/messages"))!.url,
  ).searchParams;
  assert.equal(search.get("labelIds"), null);
  assert.equal(
    search.get("q"),
    "-in:inbox -in:spam -in:trash -in:drafts is:unread",
  );
  assert.deepEqual(
    result.items.map((m: any) => m.id),
    ["a"],
  );
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.reason, "snapshot_changed");
  // Ordinary label listings still filter by label ID only.
  await f.call("messages.list", { collectionId: "Label_work" });
  const plain = new URL(f.requests.at(-3)!.url).searchParams;
  assert.equal(plain.get("labelIds"), "Label_work");
  assert.equal(plain.get("q"), null);
});

test("a provider label with the archive ID is used as-is", async (t) => {
  const f = await fixture(t, (r) =>
    new URL(r.url).pathname.endsWith("/labels")
      ? response({ labels: [{ id: "ARCHIVE", name: "ARCHIVE" }] })
      : response({ messages: [] }),
  );
  const boxes = await f.call("mailboxes.list", {});
  assert.deepEqual(
    boxes.items.map((m: any) => m.role),
    [null],
  );
  await f.call("messages.list", { collectionId: "ARCHIVE" });
  assert.equal(
    new URL(f.requests.at(-1)!.url).searchParams.get("labelIds"),
    "ARCHIVE",
  );
});
