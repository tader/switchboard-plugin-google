// Exercise real core HTTP/SSE with the Gmail contract. Provider traffic is offline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import setup from "../plugins/gmail/index.ts";
import { allowGoogleRequest } from "../plugins/google/sharing-policy.ts";
const root = process.env.SWITCHBOARD_ROOT;
assert(root, "Set SWITCHBOARD_ROOT");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gmail-contract-http-"));
process.env.SWITCHBOARD_DATA_DIR = temp;
process.env.SWITCHBOARD_SHARED_CONTRACTS = "1";
const load = (name: string) =>
  import(pathToFileURL(path.join(root, name)).href);
const database = await load("server/db.ts");
database.initDb();
const { initKey, encrypt } = await load("server/crypto.ts");
initKey();
const { createUser, createToken } = await load("server/users.ts");
const { plugins } = await load("server/plugins/manager.ts");
const { api } = await load("server/routes/connections.ts");
const { collectors, startContractCollectors } = await load(
  "server/contracts/service.ts",
);
let expired = false,
  denied = false,
  uncertain = false,
  posts = 0,
  providerReads = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "127.0.0.1") return realFetch(input, init);
  assert.equal(
    url.hostname,
    "gmail.googleapis.com",
    "Refuse unexpected network access",
  );
  const method = init?.method ?? "GET";
  if (method === "GET") providerReads++;
  else posts++;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  if (denied) return json({ error: "resource denied" }, 403);
  if (url.pathname.endsWith("/profile"))
    return json({ emailAddress: "self@example.test" });
  if (url.pathname.endsWith("/messages/send")) {
    if (uncertain) throw Error("offline ambiguous dispatch");
    return json({ id: "sent" });
  }
  if (url.pathname.endsWith("/messages"))
    return json({ messages: [{ id: "m" }] });
  if (url.pathname.endsWith("/messages/m"))
    return json({
      id: "m",
      labelIds: ["INBOX"],
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "Fixture" },
          { name: "From", value: "person@example.test" },
          { name: "To", value: "self@example.test" },
        ],
        body: { data: Buffer.from("PRIVATE-READ").toString("base64url") },
      },
    });
  throw Error("Unexpected offline provider route: " + url.pathname);
};
const service = setup({
  dataDir: temp,
  require: () => ({
    googleService: (options: any) => ({
      ...options,
      authMethods: [
        {
          id: "fixture",
          name: "Fixture",
          async authorize(req: any, conn: any) {
            if (expired)
              throw Object.assign(Error("renew credentials"), {
                reauthenticationRequired: true,
              });
            if (!allowGoogleRequest("gmail", req, conn))
              throw Object.assign(Error("denied"), { status: 403 });
            req.headers.set("authorization", "Bearer offline-fixture");
          },
        },
      ],
    }),
  }),
} as any).services[0];
(await load("server/contracts/model.ts")).validateDefinition(service.contracts);
plugins.services.set("gmail", { pluginId: "gmail", service });
assert.equal(
  fs.readFileSync("plugins/gmail/email-v1.json", "utf8"),
  fs.readFileSync(path.join(root, "server/contracts/email-v1.json"), "utf8"),
);
const { serve } = createRequire(path.join(root, "package.json"))(
  "@hono/node-server",
);
let ready: () => void;
const listening = new Promise<void>((r) => (ready = r));
const server = serve({ fetch: api.fetch, hostname: "127.0.0.1", port: 0 }, () =>
  ready(),
);
await listening;
const stop = startContractCollectors(),
  base = "http://127.0.0.1:" + server.address().port;
const user = createUser("fixture", "admin"),
  id = "gmail-fixture",
  ro = "gmail-readonly";
const credentials = {
  scope: "https://www.googleapis.com/auth/gmail.modify",
  accessToken: "offline",
};
for (const [key, access] of [
  [id, "modify"],
  [ro, "readonly"],
])
  database.run(
    "INSERT INTO connections(id,user_id,service_id,method_id,name,config_enc,credentials_enc,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    key,
    user.id,
    "gmail",
    "fixture",
    key,
    encrypt({ access }),
    encrypt(credentials),
    "ok",
    Date.now(),
    Date.now(),
  );
const token = createToken(user.id, "fixture", [id]).secret,
  roToken = createToken(user.id, "readonly", [ro]).secret;
const request = (
  url: string,
  body?: unknown,
  auth = token,
  method = body === undefined ? "GET" : "POST",
) =>
  realFetch(base + url, {
    method,
    headers: {
      authorization: "Bearer " + auth,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const call = (
  operation: string,
  args: unknown,
  key?: string,
  conn = id,
  auth = token,
) =>
  request(
    `/connections/${conn}/contracts/v1/call`,
    { operation, arguments: args, ...(key ? { idempotencyKey: key } : {}) },
    auth,
  );
try {
  const descriptor = (await (
    await request(`/connections/${id}/contracts/v1`)
  ).json()) as any;
  assert.equal(descriptor.operations.length, 15);
  assert.deepEqual(descriptor.changes, { native: false, reconciliation: true });
  assert.equal((await request(`/connections/${ro}/contracts/v1`)).status, 403);
  const sendArgs = {
    to: [{ address: "person@example.test" }],
    subject: "Fixture",
    text: "PRIVATE-SEND",
  };
  assert.equal(
    (await call("email.messages.send", sendArgs, "ro", ro, roToken)).status,
    403,
  );
  assert.equal(posts, 0);
  const messages = (await (
    await call("email.messages.list", {})
  ).json()) as any;
  assert.equal(messages.items[0].text, "PRIVATE-READ");
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        (await (
          await call("email.messages.send", sendArgs, "same-key")
        ).json()) as any
      ).status,
      "accepted",
    );
  assert.equal(posts, 1);
  assert.equal(
    (
      await call(
        "email.messages.send",
        { ...sendArgs, text: "changed" },
        "same-key",
      )
    ).status,
    409,
  );
  uncertain = true;
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        (await (
          await call("email.messages.send", sendArgs, "ambiguous-key")
        ).json()) as any
      ).status,
      "uncertain",
    );
  assert.equal(posts, 2);
  uncertain = false;
  const sub = (await (
    await request("/contracts/v1/subscriptions", { connections: [id] })
  ).json()) as any;
  await request(`/contracts/v1/subscriptions/${sub.id}/activity`, {
    active: true,
  });
  assert.equal(
    (
      (await (
        await request(`/contracts/v1/subscriptions/${sub.id}/refresh`, {
          connectionId: id,
        })
      ).json()) as any
    ).status,
    "completed",
  );
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), 3000);
  try {
    const res = await realFetch(
      base +
        `/contracts/v1/subscriptions/${sub.id}/events?cursor=${sub.cursor}`,
      { headers: { authorization: "Bearer " + token }, signal: abort.signal },
    );
    const reader = res.body!.getReader();
    let text = "";
    try {
      while (!text.includes('"type":"invalidated"')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        text += new TextDecoder().decode(chunk.value);
      }
      assert.ok(!text.includes("PRIVATE-"));
    } finally {
      await reader.cancel();
    }
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
  expired = true;
  const before = providerReads;
  assert.equal((await call("email.messages.get", { id: "m" })).status, 409);
  assert.equal(collectors().state(id).status, "auth_required");
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        (await (
          await request(`/contracts/v1/subscriptions/${sub.id}/refresh`, {
            connectionId: id,
          })
        ).json()) as any
      ).status,
      "auth_required",
    );
  assert.equal(providerReads, before);
  expired = false;
  (await load("server/connections.ts")).saveCredentials(id, {
    ...credentials,
    sessionRevision: "new-verified-credentials",
  });
  assert.notEqual(collectors().state(id).status, "auth_required");
  denied = true;
  assert.equal((await call("email.messages.get", { id: "m" })).status, 403);
  assert.notEqual(collectors().state(id).status, "auth_required");
  for (const table of ["contract_receipts", "audit_log", "contract_events"]) {
    const serialized = JSON.stringify(database.all("SELECT * FROM " + table));
    assert.ok(!serialized.includes("PRIVATE-"));
    assert.ok(
      !serialized.includes(Buffer.from("PRIVATE-SEND").toString("base64")),
    );
  }
  await request(
    `/contracts/v1/subscriptions/${sub.id}`,
    undefined,
    token,
    "DELETE",
  );
  console.log(
    "PASS: Gmail canonical HTTP/SSE, scope, durable accepted/uncertain replay, auth pause/recovery and resource 403 isolation; offline only",
  );
} finally {
  await stop();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  globalThis.fetch = realFetch;
  database.db.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
