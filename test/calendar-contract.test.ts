import { test } from "node:test";
import assert from "node:assert/strict";
import { Ajv } from "ajv";
import { contracts } from "../plugins/google-calendar/contracts.ts";
import type {
  ContractContext,
  ContractRequest,
} from "../plugins/google-calendar/types/api.d.ts";
const ajv = new Ajv({ strict: false });
function fixture(
  respond: (request: ContractRequest) => Response | Promise<Response>,
) {
  const requests: ContractRequest[] = [];
  const ctx: ContractContext = {
    connection: {
      id: "c",
      config: { access: "full" },
      credentials: { scope: "https://www.googleapis.com/auth/calendar" },
    } as any,
    signal: new AbortController().signal,
    async request(r) {
      requests.push(r);
      return respond(r);
    },
  };
  return { ctx, requests };
}
function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}
async function call(
  name: string,
  args: Record<string, unknown>,
  ctx: ContractContext,
) {
  const op = contracts.operations[name];
  assert.ok(ajv.validate(op.inputSchema, args), ajv.errorsText());
  const result = await op.invoke(args, ctx);
  assert.ok(ajv.validate(op.outputSchema, result), ajv.errorsText());
  return result as any;
}
const allDay = {
  id: "event",
  etag: '"v1"',
  summary: "Day",
  start: { date: "2026-11-03" },
  end: { date: "2026-11-04" },
};
test("effective grants and readonly binding determine capabilities", () => {
  const f = fixture(() => response({}));
  assert.equal(contracts.available(f.ctx.connection).length, 6);
  f.ctx.connection.config.access = "readonly";
  assert.equal(contracts.available(f.ctx.connection).length, 3);
  f.ctx.connection.config.access = "full";
  f.ctx.connection.credentials.scope =
    "https://www.googleapis.com/auth/calendar.readonly";
  assert.equal(contracts.available(f.ctx.connection).length, 3);
  f.ctx.connection.credentials.scope = "";
  assert.deepEqual(contracts.available(f.ctx.connection), []);
});
test("calendar pages normalize roles and use scope-bound cursors", async () => {
  const f = fixture(() =>
    response({
      items: [
        {
          id: "calendar@example.test",
          summary: "Work",
          timeZone: "Europe/Amsterdam",
          accessRole: "reader",
        },
      ],
      nextPageToken: "page two",
    }),
  );
  const page = await call("calendar.calendars.list", {}, f.ctx);
  assert.equal(page.items[0].canWrite, false);
  assert.equal(page.coverage.complete, false);
  assert.ok(page.nextCursor);
  await call("calendar.calendars.list", { cursor: page.nextCursor }, f.ctx);
  assert.equal(
    new URL(f.requests[1].url).searchParams.get("pageToken"),
    "page two",
  );
  f.ctx.connection.id = "another";
  await assert.rejects(
    () => call("calendar.calendars.list", { cursor: page.nextCursor }, f.ctx),
    { code: "invalid_cursor" },
  );
});
test("bounded event snapshot expands instances and preserves exclusive all-day ends", async () => {
  const f = fixture(() =>
    response({
      timeZone: "Europe/Amsterdam",
      items: [
        allDay,
        { id: "gone", status: "cancelled" },
        {
          ...allDay,
          id: "instance",
          recurringEventId: "series",
          start: { dateTime: "2026-11-03T09:00:00+01:00" },
          end: { dateTime: "2026-11-03T10:00:00+01:00" },
        },
      ],
    }),
  );
  const result = await call(
    "calendar.events.list",
    {
      calendarId: "cal@example.test",
      timeMin: "2026-11-01T00:00:00Z",
      timeMax: "2026-12-01T00:00:00Z",
    },
    f.ctx,
  );
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0].end, { date: "2026-11-04" });
  assert.equal(result.items[1].start.timeZone, "Europe/Amsterdam");
  assert.equal(result.items[1].seriesId, "series");
  const url = new URL(f.requests[0].url);
  assert.equal(url.searchParams.get("singleEvents"), "true");
  assert.equal(url.searchParams.get("showDeleted"), "false");
});
test("create sends only shared fields without invitations and rejects invalid ranges", async () => {
  const f = fixture(() => response(allDay));
  const input = {
    calendarId: "cal",
    event: { title: "Day", start: allDay.start, end: allDay.end },
  };
  const result = await call("calendar.events.create", input, f.ctx);
  assert.deepEqual(result, {
    status: "accepted",
    resourceId: "event",
    version: '"v1"',
  });
  assert.equal(f.requests[0].method, "POST");
  assert.equal(
    new URL(f.requests[0].url).searchParams.get("sendUpdates"),
    "none",
  );
  assert.equal(JSON.parse(String(f.requests[0].body)).summary, "Day");
  assert.deepEqual(
    await call(
      "calendar.events.create",
      { ...input, event: { ...input.event, end: allDay.start } },
      f.ctx,
    ),
    { status: "rejected", code: "invalid_request" },
  );
  assert.equal(f.requests.length, 1);
  assert.deepEqual(
    await call(
      "calendar.events.create",
      { ...input, event: { ...input.event, start: { date: "2026-02-30" } } },
      f.ctx,
    ),
    { status: "rejected", code: "invalid_request" },
  );
  assert.equal(f.requests.length, 1);
});
test("update validates versions and keeps If-Match on the actual write", async () => {
  const f = fixture((r) =>
    response(
      r.method === "PATCH"
        ? { ...allDay, etag: '"v2"' }
        : r.url.endsWith("/calendars/cal")
          ? { timeZone: "Europe/Amsterdam" }
          : allDay,
    ),
  );
  assert.deepEqual(
    await call(
      "calendar.events.update",
      {
        calendarId: "cal",
        id: "event",
        version: '"stale"',
        changes: { title: "new" },
      },
      f.ctx,
    ),
    { status: "rejected", code: "conflict" },
  );
  assert.equal(f.requests.length, 1);
  const result = await call(
    "calendar.events.update",
    {
      calendarId: "cal",
      id: "event",
      version: '"v1"',
      changes: { title: "new" },
    },
    f.ctx,
  );
  assert.equal(result.version, '"v2"');
  assert.ok(
    f.requests
      .at(-1)!
      .headers!.some(([k, v]) => k === "if-match" && v === '"v1"'),
  );
  assert.deepEqual(JSON.parse(String(f.requests.at(-1)!.body)), {
    summary: "new",
  });
});
test("delete treats precondition failure as rejected; transport errors remain ambiguous", async () => {
  const f = fixture(() => response({}, 412));
  assert.deepEqual(
    await call(
      "calendar.events.delete",
      { calendarId: "cal", id: "event", version: '"v1"' },
      f.ctx,
    ),
    { status: "rejected", code: "conflict" },
  );
  assert.ok(f.requests[0].headers!.some(([k]) => k === "if-match"));
  const g = fixture(() => {
    throw Error("network lost");
  });
  await assert.rejects(
    () =>
      call(
        "calendar.events.delete",
        { calendarId: "cal", id: "event", version: '"v1"' },
        g.ctx,
      ),
    /network lost/,
  );
});
test("collector checks provider auth and emits only broad invalidation metadata", async () => {
  const f = fixture(() => response({ items: [] }));
  const batch = await contracts.collect!({}, f.ctx);
  assert.ok(batch.checkpoint);
  assert.deepEqual(batch.events[0].event, {
    category: "calendar",
    type: "invalidated",
    resourceType: "calendars",
  });
  assert.equal(f.requests.length, 1);
  const g = fixture(() => response({}, 401));
  await assert.rejects(() => contracts.collect!({}, g.ctx), {
    code: "authentication_required",
  });
  const h = fixture(
    () =>
      new Response("{}", { status: 429, headers: { "retry-after": "120" } }),
  );
  await assert.rejects(() => contracts.collect!({}, h.ctx), {
    retryAfterMs: 120000,
  });
});
