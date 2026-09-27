import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));

  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

function requireProbeKey(request, env) {
  if (!env.PROBE_KEY) {
    return json({
      ok: false,
      error: "PROBE_KEY is not configured on the Worker."
    }, 503);
  }

  const supplied = request.headers.get("x-wikidex-probe-key") || "";
  if (!safeEqual(supplied, env.PROBE_KEY)) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  return null;
}

async function probeWikiMastersAuth(env) {
  if (!env.WIKIMASTERS_COOKIE && !env.WIKIMASTERS_AUTHORIZATION) {
    return json({
      ok: false,
      authenticated: false,
      error: "No WikiMasters credential is configured."
    }, 503);
  }

  const headers = new Headers({
    accept: "application/json, text/plain, */*",
    origin: "https://www.wiki-masters.com",
    referer: "https://www.wiki-masters.com/"
  });

  if (env.WIKIMASTERS_COOKIE) {
    headers.set("cookie", env.WIKIMASTERS_COOKIE);
  }

  if (env.WIKIMASTERS_AUTHORIZATION) {
    headers.set("authorization", env.WIKIMASTERS_AUTHORIZATION);
  }

  const url = new URL("https://www.wiki-masters.com/api/my-collection");
  url.searchParams.set("sort", "rarity");
  url.searchParams.set("rarity", "C");
  url.searchParams.set("page", "0");
  url.searchParams.set("stats", "0");

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      method: "GET",
      headers,
      redirect: "manual"
    });
  } catch (error) {
    return json({
      ok: false,
      authenticated: false,
      upstreamStatus: 0,
      error: "Network error while contacting WikiMasters.",
      detail: error?.message || String(error)
    }, 502);
  }

  const contentType = upstream.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    try {
      data = await upstream.json();
    } catch {}
  } else {
    await upstream.text().catch(() => "");
  }

  const rows = Array.isArray(data?.collection) ? data.collection : null;
  const looksAuthenticated =
    upstream.ok &&
    Array.isArray(rows) &&
    rows.every(row => row && typeof row === "object");

  return json({
    ok: looksAuthenticated,
    authenticated: looksAuthenticated,
    upstreamStatus: upstream.status,
    upstreamContentType: contentType || null,
    commonCardsOnFirstPage: rows?.length ?? null,
    hasPendingTradeField: Array.isArray(data?.pendingTradeCardIds),
    hasCollectionShape: Array.isArray(rows),
    note: looksAuthenticated
      ? "Server-side authenticated read succeeded."
      : "Server-side authenticated read did not succeed."
  }, looksAuthenticated ? 200 : 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "wikidex-cloud-poc",
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/probe/auth") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      return probeWikiMastersAuth(env);
    }

    if (url.pathname === "/probe/timer/start") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      const stub = env.TIMER_PROBE.get(
        env.TIMER_PROBE.idFromName("wikidex-timer-probe")
      );

      return stub.fetch(new Request("https://timer.internal/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await request.text()
      }));
    }

    if (url.pathname === "/probe/timer/status") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      const stub = env.TIMER_PROBE.get(
        env.TIMER_PROBE.idFromName("wikidex-timer-probe")
      );

      return stub.fetch("https://timer.internal/status");
    }

    return json({
      ok: false,
      error: "Not found.",
      routes: [
        "GET /health",
        "GET /probe/auth",
        "POST /probe/timer/start",
        "GET /probe/timer/status"
      ]
    }, 404);
  }
};

export class TimerProbe extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/start" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const intervalMs = Math.max(
        1000,
        Math.min(60_000, Math.round(Number(body.intervalMs) || 2000))
      );
      const count = Math.max(
        1,
        Math.min(60, Math.round(Number(body.count) || 10))
      );

      const state = {
        intervalMs,
        requestedTicks: count,
        startedAt: Date.now(),
        ticks: [],
        finishedAt: null
      };

      await this.ctx.storage.put("timerProbe", state);
      await this.ctx.storage.setAlarm(Date.now() + intervalMs);

      return json({
        ok: true,
        intervalMs,
        requestedTicks: count,
        startedAt: new Date(state.startedAt).toISOString()
      });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const state = await this.ctx.storage.get("timerProbe");

      if (!state) {
        return json({
          ok: true,
          running: false,
          message: "No timer probe has been started yet."
        });
      }

      const deltas = [];
      for (let i = 1; i < state.ticks.length; i++) {
        deltas.push(state.ticks[i] - state.ticks[i - 1]);
      }

      const firstDelay = state.ticks.length
        ? state.ticks[0] - state.startedAt
        : null;

      const averageDelta = deltas.length
        ? Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length)
        : null;

      return json({
        ok: true,
        running: !state.finishedAt,
        intervalMs: state.intervalMs,
        requestedTicks: state.requestedTicks,
        observedTicks: state.ticks.length,
        firstDelayMs: firstDelay,
        averageDeltaMs: averageDelta,
        minDeltaMs: deltas.length ? Math.min(...deltas) : null,
        maxDeltaMs: deltas.length ? Math.max(...deltas) : null,
        ticks: state.ticks.map(ts => new Date(ts).toISOString()),
        finishedAt: state.finishedAt
          ? new Date(state.finishedAt).toISOString()
          : null
      });
    }

    return json({ ok: false, error: "Timer route not found." }, 404);
  }

  async alarm() {
    try {
      const state = await this.ctx.storage.get("timerProbe");
      if (!state || state.finishedAt) return;

      const now = Date.now();
      state.ticks.push(now);

      if (state.ticks.length >= state.requestedTicks) {
        state.finishedAt = now;
        await this.ctx.storage.put("timerProbe", state);
        return;
      }

      await this.ctx.storage.put("timerProbe", state);
      await this.ctx.storage.setAlarm(now + state.intervalMs);
    } catch (error) {
      // Do not throw: Durable Object alarms are at-least-once. Throwing would
      // ask Cloudflare to retry the alarm automatically.
      const state = await this.ctx.storage.get("timerProbe").catch(() => null);
      if (state && !state.finishedAt) {
        state.lastError = error?.message || String(error);
        await this.ctx.storage.put("timerProbe", state).catch(() => {});
        await this.ctx.storage.setAlarm(Date.now() + 5000).catch(() => {});
      }
    }
  }
}
