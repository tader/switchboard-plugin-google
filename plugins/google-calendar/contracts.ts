import { randomUUID } from "node:crypto";
import type {
  CalendarEvent,
  Connection,
  ContractContext,
  ContractDefinition,
  ContractOperation,
  WriteReceipt,
} from "./types/api.d.ts";
import { calendarOperations } from "./calendar-schema.ts";
const ROOT = "https://www.googleapis.com/calendar/v3";
const PREFIX = "https://www.googleapis.com/auth/";
const READ = ["calendar", "calendar.readonly"];
const WRITE = ["calendar"];
function scopes(c: Connection) {
  return new Set(String(c.credentials.scope ?? "").split(/\s+/));
}
function has(c: Connection, values: string[]) {
  return values.some((s) => scopes(c).has(PREFIX + s));
}
function fail(code: string): never {
  throw Object.assign(Error(code), { code });
}
function segment(id: unknown) {
  if (
    typeof id !== "string" ||
    !id ||
    id === "." ||
    id === ".." ||
    /[\\/]/.test(id)
  )
    return fail("invalid_request");
  return encodeURIComponent(id);
}
async function request(
  ctx: ContractContext,
  path: string,
  method = "GET",
  body?: unknown,
  headers: [string, string][] = [],
) {
  const response = await ctx.request({
    url: ROOT + path,
    method,
    headers: [["content-type", "application/json"], ...headers],
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) return fail("authentication_required");
  if (response.status === 429 || response.status >= 500) {
    const delay = response.headers.get("retry-after");
    const seconds = delay ? Number(delay) : NaN;
    throw Object.assign(Error("source_unavailable"), {
      code: "source_unavailable",
      retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : undefined,
    });
  }
  if (!response.ok) {
    const code =
      response.status === 412 || response.status === 409
        ? "conflict"
        : response.status === 404
          ? "not_found"
          : response.status === 403
            ? "permission_denied"
            : "invalid_request";
    throw Object.assign(Error(code), { code, status: response.status });
  }
  return response.status === 204 ? {} : await response.json();
}
function cursor(token: string | undefined, binding: unknown) {
  return token
    ? Buffer.from(JSON.stringify({ token, binding })).toString("base64url")
    : undefined;
}
function pageToken(value: unknown, binding: unknown) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(String(value), "base64url").toString(),
    );
    if (
      typeof parsed.token !== "string" ||
      JSON.stringify(parsed.binding) !== JSON.stringify(binding)
    )
      return fail("invalid_cursor");
    return parsed.token;
  } catch {
    return fail("invalid_cursor");
  }
}
function query(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== undefined) params.set(k, String(v));
  return "?" + params;
}
function dateTime(value: any, zone: string) {
  if (value?.date) return { date: value.date };
  if (!value?.dateTime) return fail("invalid_provider_response");
  return { dateTime: value.dateTime, timeZone: value.timeZone ?? zone };
}
function event(raw: any, calendarId: string, zone: string): CalendarEvent {
  if (typeof raw.id !== "string") return fail("invalid_provider_response");
  return {
    id: raw.id,
    calendarId,
    title: raw.summary ?? "",
    start: dateTime(raw.start, zone),
    end: dateTime(raw.end, zone),
    ...(raw.etag ? { version: raw.etag } : {}),
    ...(raw.description ? { description: raw.description } : {}),
    ...(raw.location ? { location: raw.location } : {}),
    ...(raw.recurringEventId
      ? { seriesId: raw.recurringEventId, occurrenceId: raw.id }
      : {}),
  };
}
async function calendar(ctx: ContractContext, id: string) {
  return request(ctx, "/calendars/" + segment(id));
}
function validTimes(value: any) {
  const a = value.start,
    b = value.end;
  if (!a || !b || Boolean(a.date) !== Boolean(b.date))
    return fail("invalid_request");
  for (const time of [a, b]) {
    if (time.date) {
      const d = new Date(time.date);
      if (
        !Number.isFinite(d.valueOf()) ||
        d.toISOString().slice(0, 10) !== time.date
      )
        return fail("invalid_request");
    } else {
      try {
        new Intl.DateTimeFormat("en", { timeZone: time.timeZone });
      } catch {
        return fail("invalid_request");
      }
      if (!Number.isFinite(Date.parse(time.dateTime)))
        return fail("invalid_request");
    }
  }
  if (Date.parse(a.date ?? a.dateTime) >= Date.parse(b.date ?? b.dateTime))
    return fail("invalid_request");
}
function payload(value: any) {
  return {
    ...(value.title !== undefined ? { summary: value.title } : {}),
    ...(value.start ? { start: value.start } : {}),
    ...(value.end ? { end: value.end } : {}),
    ...(value.description !== undefined
      ? { description: value.description }
      : {}),
    ...(value.location !== undefined ? { location: value.location } : {}),
  };
}
function rejection(error: any): WriteReceipt {
  if (
    ["conflict", "not_found", "invalid_request", "permission_denied"].includes(
      error.code,
    )
  )
    return { status: "rejected", code: error.code };
  throw error;
}
function operation(
  name: string,
  invoke: ContractOperation["invoke"],
): ContractOperation {
  return {
    category: "calendar",
    readOnly: /\.(list|get)$/.test(name),
    ...calendarOperations[name],
    invoke,
  };
}
const operations: ContractDefinition["operations"] = {
  "calendar.calendars.list": operation(
    "calendar.calendars.list",
    async (input, ctx) => {
      const binding = { kind: "calendars", connection: ctx.connection.id };
      const data = await request(
        ctx,
        "/users/me/calendarList" +
          query({
            maxResults: input.limit ?? 100,
            minAccessRole: "reader",
            pageToken: pageToken(input.cursor, binding),
          }),
      );
      return {
        items: (data.items ?? []).map((c: any) => ({
          id: c.id,
          name: c.summaryOverride ?? c.summary ?? c.id,
          timeZone: c.timeZone ?? null,
          canWrite:
            has(ctx.connection, WRITE) &&
            ctx.connection.config.access !== "readonly" &&
            ["writer", "owner"].includes(c.accessRole),
        })),
        ...(data.nextPageToken
          ? { nextCursor: cursor(data.nextPageToken, binding) }
          : {}),
        coverage: {
          complete: !data.nextPageToken,
          ...(data.nextPageToken ? { reason: "more_pages" } : {}),
        },
      };
    },
  ),
  "calendar.events.list": operation(
    "calendar.events.list",
    async (input, ctx) => {
      const min = Date.parse(String(input.timeMin)),
        max = Date.parse(String(input.timeMax));
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max)
        return fail("invalid_request");
      const id = String(input.calendarId);
      const binding = {
        kind: "events",
        connection: ctx.connection.id,
        calendarId: id,
        timeMin: input.timeMin,
        timeMax: input.timeMax,
      };
      const data = await request(
        ctx,
        "/calendars/" +
          segment(id) +
          "/events" +
          query({
            singleEvents: true,
            showDeleted: false,
            timeMin: input.timeMin,
            timeMax: input.timeMax,
            orderBy: "startTime",
            maxResults: input.limit ?? 100,
            pageToken: pageToken(input.cursor, binding),
          }),
      );
      const zone = data.timeZone ?? (await calendar(ctx, id)).timeZone ?? "UTC";
      return {
        items: (data.items ?? [])
          .filter((e: any) => e.status !== "cancelled")
          .map((e: any) => event(e, id, zone)),
        ...(data.nextPageToken
          ? { nextCursor: cursor(data.nextPageToken, binding) }
          : {}),
        coverage: {
          complete: !data.nextPageToken,
          ...(data.nextPageToken ? { reason: "more_pages" } : {}),
        },
      };
    },
  ),
  "calendar.events.get": operation(
    "calendar.events.get",
    async (input, ctx) => {
      const id = String(input.calendarId);
      const raw = await request(
        ctx,
        "/calendars/" + segment(id) + "/events/" + segment(input.id),
      );
      if (raw.status === "cancelled") return fail("not_found");
      const zone =
        raw.start?.timeZone ?? (await calendar(ctx, id)).timeZone ?? "UTC";
      return event(raw, id, zone);
    },
  ),
  "calendar.events.create": operation(
    "calendar.events.create",
    async (input, ctx) => {
      try {
        validTimes(input.event);
        const raw = await request(
          ctx,
          "/calendars/" +
            segment(input.calendarId) +
            "/events?sendUpdates=none",
          "POST",
          payload(input.event),
        );
        return { status: "accepted", resourceId: raw.id, version: raw.etag };
      } catch (error) {
        return rejection(error);
      }
    },
  ),
  "calendar.events.update": operation(
    "calendar.events.update",
    async (input, ctx) => {
      try {
        const path =
          "/calendars/" +
          segment(input.calendarId) +
          "/events/" +
          segment(input.id);
        const current = await request(ctx, path);
        if (current.etag !== input.version)
          return { status: "rejected", code: "conflict" };
        const changes = input.changes as any;
        const zone =
          current.start?.timeZone ??
          (await calendar(ctx, String(input.calendarId))).timeZone ??
          "UTC";
        validTimes({
          ...event(current, String(input.calendarId), zone),
          ...changes,
        });
        const raw = await request(
          ctx,
          path + "?sendUpdates=none",
          "PATCH",
          payload(changes),
          [["if-match", String(input.version)]],
        );
        return { status: "accepted", resourceId: raw.id, version: raw.etag };
      } catch (error) {
        return rejection(error);
      }
    },
  ),
  "calendar.events.delete": operation(
    "calendar.events.delete",
    async (input, ctx) => {
      try {
        await request(
          ctx,
          "/calendars/" +
            segment(input.calendarId) +
            "/events/" +
            segment(input.id) +
            "?sendUpdates=none",
          "DELETE",
          undefined,
          [["if-match", String(input.version)]],
        );
        return { status: "accepted", resourceId: String(input.id) };
      } catch (error) {
        return rejection(error);
      }
    },
  ),
};
export const contracts: ContractDefinition = {
  version: 1,
  operations,
  available(connection) {
    if (!has(connection, READ)) return [];
    return Object.keys(operations).filter(
      (name) =>
        operations[name].readOnly ||
        (connection.config.access !== "readonly" && has(connection, WRITE)),
    );
  },
  async collect(_input, ctx) {
    // Coarse reconciliation until native watch registration is available. This proves
    // current provider access and invalidates the connection's calendar snapshot.
    await request(
      ctx,
      "/users/me/calendarList?maxResults=1&minAccessRole=reader",
    );
    const id = randomUUID();
    return {
      events: [
        {
          sourceId: id,
          event: {
            category: "calendar",
            type: "invalidated",
            resourceType: "calendars",
          },
        },
      ],
      checkpoint: id,
    };
  },
};
