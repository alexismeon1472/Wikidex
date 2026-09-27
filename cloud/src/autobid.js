import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const CLOSED_STATUSES = new Set([
  "settled_sold",
  "settled_unsold",
  "sold",
  "closed",
  "expired",
  "cancelled",
  "canceled",
  "ended",
  "settled"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}

function normalizeListingId(value) {
  const match = String(value || "").match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return match ? match[0].toLowerCase() : null;
}

function nextBid(base) {
  const n = Number(base);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.max(Math.ceil(n * 1.10), Math.floor(n) + 1);
}

function isClosed(auction, now = Date.now()) {
  const status = String(auction?.status || "").toLowerCase();
  if (CLOSED_STATUSES.has(status)) return true;

  const end = Date.parse(auction?.end_at || auction?.endAt || "");
  return Number.isFinite(end) && end <= now;
}

function auctionTitle(auction) {
  return (
    auction?.card?.wikipedia_title ||
    auction?.snapshot_search_document ||
    auction?.card?.category ||
    "Enchère"
  );
}

function pollDelayMs(auction, now = Date.now()) {
  const end = Date.parse(auction?.end_at || auction?.endAt || "");
  if (!Number.isFinite(end)) return 5000;

  const remaining = end - now;
  if (remaining <= 20_000) return 2000;
  if (remaining <= 60_000) return 5000;
  if (remaining <= 5 * 60_000) return 10_000;
  if (remaining <= 15 * 60_000) return 30_000;
  return 60_000;
}

function addEvent(state, event) {
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.push({
    at: new Date().toISOString(),
    ...event
  });
  state.events = state.events.slice(-100);
}

function addAttemptKey(state, key) {
  const keys = Array.isArray(state.attemptedKeys) ? state.attemptedKeys : [];
  if (!keys.includes(key)) keys.push(key);
  state.attemptedKeys = keys.slice(-200);
}

function hasAttemptKey(state, key) {
  return Array.isArray(state.attemptedKeys) && state.attemptedKeys.includes(key);
}

function wikiHeaders(credentials, withJsonBody = false) {
  const headers = new Headers({
    accept: "application/json, text/plain, */*",
    origin: "https://www.wiki-masters.com",
    referer: "https://www.wiki-masters.com/marketplace"
  });

  const cookie =
    credentials?.cookie ||
    credentials?.WIKIMASTERS_COOKIE ||
    "";

  const authorization =
    credentials?.authorization ||
    credentials?.WIKIMASTERS_AUTHORIZATION ||
    "";

  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);

  if (withJsonBody) {
    headers.set("content-type", "application/json");
  }

  return headers;
}

async function fetchAuction(credentials, listingId) {
  const response = await fetch(
    "https://www.wiki-masters.com/api/marketplace/" +
      encodeURIComponent(listingId),
    {
      method: "GET",
      headers: wikiHeaders(credentials),
      redirect: "manual"
    }
  );

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    throw new Error("Auction GET failed with HTTP " + response.status);
  }

  const auction = data?.auction || data;
  if (!auction || typeof auction !== "object") {
    throw new Error("Auction response is not valid JSON.");
  }

  return auction;
}

async function fetchUserId(credentials) {
  const url = new URL("https://www.wiki-masters.com/api/my-collection");
  url.searchParams.set("sort", "rarity");
  url.searchParams.set("rarity", "C");
  url.searchParams.set("page", "0");
  url.searchParams.set("stats", "0");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: wikiHeaders(credentials),
    redirect: "manual"
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    throw new Error("User lookup failed with HTTP " + response.status);
  }

  const rows = Array.isArray(data?.collection) ? data.collection : [];
  const userId = rows.find(row => row?.user_id)?.user_id || null;

  if (!userId) {
    throw new Error("Unable to derive current WikiMasters user id.");
  }

  return String(userId);
}

async function postBidOnce(credentials, listingId, amount) {
  // CRITICAL INVARIANT:
  // This function performs exactly one state-changing request.
  // The caller must never automatically retry an ambiguous result.
  let response;

  try {
    response = await fetch(
      "https://www.wiki-masters.com/api/marketplace/" +
        encodeURIComponent(listingId) +
        "/bid",
      {
        method: "POST",
        headers: wikiHeaders(credentials, true),
        body: JSON.stringify({ amount }),
        redirect: "manual"
      }
    );
  } catch (error) {
    return {
      outcome: "ambiguous",
      httpStatus: 0,
      error: error?.message || String(error)
    };
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : data?.error || data?.message || text || "Bid rejected.";

    return {
      outcome: "rejected",
      httpStatus: response.status,
      error: String(message).slice(0, 240)
    };
  }

  const balance = Number(data?.balance);

  return {
    outcome: "accepted",
    httpStatus: response.status,
    balance: Number.isFinite(balance) ? balance : null
  };
}

async function resolveWikiCredentials(env, accountId) {
  if (!accountId) {
    const credentials = {
      cookie: env.WIKIMASTERS_COOKIE || "",
      authorization: env.WIKIMASTERS_AUTHORIZATION || ""
    };

    if (!credentials.cookie && !credentials.authorization) {
      throw new Error("WikiMasters credentials are not configured.");
    }

    return credentials;
  }

  if (!env.USER_ACCOUNT) {
    throw new Error("USER_ACCOUNT binding is not configured.");
  }

  const stub = env.USER_ACCOUNT.get(
    env.USER_ACCOUNT.idFromName(String(accountId))
  );

  const response = await stub.fetch("https://account.internal/credentials");
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.credentials) {
    throw new Error(data?.error || "WikiMasters session is not connected.");
  }

  return data.credentials;
}

function publicState(state) {
  if (!state) {
    return {
      ok: true,
      configured: false,
      running: false
    };
  }

  return {
    ok: true,
    configured: true,
    running: !!state.enabled && !state.finishedAt && !state.stoppedAt,
    listingId: state.listingId,
    title: state.title,
    max: state.max,
    status: state.status || null,
    currentBid: state.currentBid ?? null,
    nextBid: state.nextBid ?? null,
    endAt: state.endAt || null,
    startedAt: state.startedAt
      ? new Date(state.startedAt).toISOString()
      : null,
    stoppedAt: state.stoppedAt
      ? new Date(state.stoppedAt).toISOString()
      : null,
    finishedAt: state.finishedAt
      ? new Date(state.finishedAt).toISOString()
      : null,
    lastReadAt: state.lastReadAt
      ? new Date(state.lastReadAt).toISOString()
      : null,
    lastAction: state.lastAction || null,
    readErrors: state.readErrors || 0,
    bidAttempts: Array.isArray(state.attempts) ? state.attempts.length : 0,
    lastBalance: state.lastBalance ?? null,
    events: Array.isArray(state.events) ? state.events.slice(-40) : [],
    attempts: Array.isArray(state.attempts)
      ? state.attempts.slice(-20).map(x => ({
          id: x.id,
          key: x.key,
          amount: x.amount,
          basedOnBid: x.basedOnBid,
          preparedAt: x.preparedAt,
          completedAt: x.completedAt || null,
          outcome: x.outcome,
          httpStatus: x.httpStatus ?? null,
          error: x.error || null
        }))
      : []
  };
}

export class AutoBidEngine extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/start" && request.method === "POST") {
      if (String(this.env.AUTOBID_WRITES_ENABLED || "").toLowerCase() !== "true") {
        return json({
          ok: false,
          error:
            "Real AutoBid write gate is disabled. Set AUTOBID_WRITES_ENABLED=true explicitly."
        }, 503);
      }

      let body = {};
      try {
        body = await request.json();
      } catch {}

      if (body.confirm !== "REAL_BIDS") {
        return json({
          ok: false,
          error: 'Explicit confirmation required: confirm must equal "REAL_BIDS".'
        }, 400);
      }

      const listingId = normalizeListingId(body.listing);
      const max = Math.floor(Number(body.max));

      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      if (!Number.isFinite(max) || max <= 0) {
        return json({ ok: false, error: "Invalid max amount." }, 400);
      }

      const accountId = body.accountId
        ? String(body.accountId)
        : null;

      let credentials;
      try {
        credentials = await resolveWikiCredentials(this.env, accountId);
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 503);
      }

      const userId = await fetchUserId(credentials);
      const auction = await fetchAuction(credentials, listingId);
      const now = Date.now();

      if (isClosed(auction, now)) {
        return json({
          ok: false,
          error: "Auction is already closed."
        }, 409);
      }

      const sellerId = auction?.seller_id || auction?.sellerId || null;
      if (sellerId && String(sellerId) === userId) {
        return json({
          ok: false,
          error: "AutoBid refused because this account is the seller."
        }, 409);
      }

      const state = {
        schemaVersion: 2,
        accountId,
        listingId,
        max,
        userId,
        enabled: true,
        startedAt: now,
        stoppedAt: null,
        finishedAt: null,
        lastReadAt: now,
        readErrors: 0,
        title: auctionTitle(auction),
        status: auction.status || null,
        currentBid: Number(
          auction.current_bid ??
          auction.currentBid ??
          auction.base_amount ??
          auction.baseAmount ??
          0
        ),
        nextBid: null,
        endAt: auction.end_at || auction.endAt || null,
        lastAction: "armed",
        attemptedKeys: [],
        attempts: [],
        events: []
      };

      addEvent(state, {
        action: "armed",
        max,
        note: "Real writes are enabled for this listing only."
      });

      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.setAlarm(now + 1000);

      return json({
        ok: true,
        armed: true,
        listingId,
        title: state.title,
        max,
        endAt: state.endAt,
        note:
          "AutoBid is armed. Every bid decision is persisted before a single POST /bid attempt."
      });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const state = await this.ctx.storage.get("autoBid");
      return json(publicState(state));
    }

    if (url.pathname === "/stop" && request.method === "POST") {
      const state = await this.ctx.storage.get("autoBid");

      if (!state) {
        return json({ ok: true, stopped: false, message: "No AutoBid configured." });
      }

      state.enabled = false;
      state.stoppedAt = Date.now();
      state.lastAction = "stopped-by-user";
      addEvent(state, { action: "stopped-by-user" });

      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.deleteAlarm();

      return json({
        ok: true,
        stopped: true,
        listingId: state.listingId
      });
    }

    if (url.pathname === "/max" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const max = Math.floor(Number(body.max));
      if (!Number.isFinite(max) || max <= 0) {
        return json({ ok: false, error: "Invalid max amount." }, 400);
      }

      const state = await this.ctx.storage.get("autoBid");
      if (!state) {
        return json({ ok: false, error: "No AutoBid configured." }, 404);
      }

      state.max = max;
      state.lastAction = "max-updated";
      addEvent(state, { action: "max-updated", max });
      await this.ctx.storage.put("autoBid", state);

      return json({ ok: true, listingId: state.listingId, max });
    }

    return json({ ok: false, error: "AutoBid route not found." }, 404);
  }

  async alarm() {
    // Cloudflare alarms are at-least-once. Never throw from this handler:
    // a thrown alarm may be retried automatically.
    try {
      await this.runCycle();
    } catch (error) {
      const state = await this.ctx.storage.get("autoBid").catch(() => null);
      if (!state || !state.enabled || state.finishedAt || state.stoppedAt) return;

      state.readErrors = (state.readErrors || 0) + 1;
      state.lastAction = "engine-error";
      addEvent(state, {
        action: "engine-error",
        error: error?.message || String(error)
      });

      await this.ctx.storage.put("autoBid", state).catch(() => {});
      await this.ctx.storage.setAlarm(Date.now() + 5000).catch(() => {});
    }
  }

  async runCycle() {
    let state = await this.ctx.storage.get("autoBid");
    if (!state || !state.enabled || state.finishedAt || state.stoppedAt) return;

    if (String(this.env.AUTOBID_WRITES_ENABLED || "").toLowerCase() !== "true") {
      state.enabled = false;
      state.lastAction = "global-write-gate-disabled";
      addEvent(state, { action: "global-write-gate-disabled" });
      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const now = Date.now();
    let credentials;
    let auction;

    try {
      credentials = await resolveWikiCredentials(this.env, state.accountId || null);
      auction = await fetchAuction(credentials, state.listingId);
      state.lastReadAt = now;
      state.readErrors = 0;
    } catch (error) {
      state.readErrors = (state.readErrors || 0) + 1;
      state.lastAction = "read-error";
      addEvent(state, {
        action: "read-error",
        error: error?.message || String(error)
      });
      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.setAlarm(now + Math.min(30_000, 5000 * Math.max(1, state.readErrors)));
      return;
    }

    const currentBid = Number(
      auction.current_bid ??
      auction.currentBid ??
      auction.base_amount ??
      auction.baseAmount ??
      0
    );

    const currentBidderId =
      auction.current_bidder_id ||
      auction.currentBidderId ||
      null;

    const sellerId = auction.seller_id || auction.sellerId || null;

    state.title = auctionTitle(auction);
    state.status = auction.status || null;
    state.currentBid = Number.isFinite(currentBid) ? currentBid : null;
    state.endAt = auction.end_at || auction.endAt || null;
    state.nextBid = nextBid(currentBid);

    if (isClosed(auction, now)) {
      state.enabled = false;
      state.finishedAt = now;
      state.lastAction =
        currentBidderId && String(currentBidderId) === String(state.userId)
          ? "finished-won"
          : "finished";

      addEvent(state, {
        action: state.lastAction,
        currentBid: state.currentBid,
        status: state.status
      });

      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.deleteAlarm();
      return;
    }

    if (sellerId && String(sellerId) === String(state.userId)) {
      state.enabled = false;
      state.finishedAt = now;
      state.lastAction = "seller-guard";
      addEvent(state, { action: "seller-guard" });
      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.deleteAlarm();
      return;
    }

    if (currentBidderId && String(currentBidderId) === String(state.userId)) {
      state.lastAction = "already-highest";
      addEvent(state, {
        action: "already-highest",
        currentBid: state.currentBid
      });
      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.setAlarm(now + pollDelayMs(auction, now));
      return;
    }

    const amount = nextBid(currentBid);
    if (!Number.isFinite(amount)) {
      state.lastAction = "invalid-bid-state";
      addEvent(state, { action: "invalid-bid-state" });
      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.setAlarm(now + 5000);
      return;
    }

    if (amount > Number(state.max)) {
      state.enabled = false;
      state.finishedAt = now;
      state.lastAction = "cap-reached";
      addEvent(state, {
        action: "cap-reached",
        currentBid: state.currentBid,
        nextBid: amount,
        max: state.max
      });
      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const end = Date.parse(auction.end_at || auction.endAt || "");
    if (Number.isFinite(end) && end - now < 500) {
      state.lastAction = "too-late-no-post";
      addEvent(state, {
        action: "too-late-no-post",
        remainingMs: Math.max(0, end - now)
      });
      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.setAlarm(now + 2000);
      return;
    }

    const decisionKey =
      String(currentBidderId || "none") +
      "|" +
      String(currentBid) +
      "|" +
      String(amount);

    if (hasAttemptKey(state, decisionKey)) {
      state.lastAction = "same-decision-no-repeat";
      addEvent(state, {
        action: "same-decision-no-repeat",
        currentBid: state.currentBid,
        nextBid: amount
      });
      await this.ctx.storage.put("autoBid", state);
      await this.ctx.storage.setAlarm(now + pollDelayMs(auction, now));
      return;
    }

    // Re-read state immediately before preparing the write so a user stop or
    // ceiling reduction that arrived during the GET phase is respected.
    const fresh = await this.ctx.storage.get("autoBid");
    if (!fresh || !fresh.enabled || fresh.stoppedAt || fresh.finishedAt) return;

    if (amount > Number(fresh.max)) {
      fresh.enabled = false;
      fresh.finishedAt = Date.now();
      fresh.lastAction = "cap-reached-before-post";
      addEvent(fresh, {
        action: "cap-reached-before-post",
        nextBid: amount,
        max: fresh.max
      });
      await this.ctx.storage.put("autoBid", fresh);
      await this.ctx.storage.deleteAlarm();
      return;
    }

    if (hasAttemptKey(fresh, decisionKey)) {
      fresh.lastAction = "same-decision-no-repeat";
      await this.ctx.storage.put("autoBid", fresh);
      await this.ctx.storage.setAlarm(Date.now() + pollDelayMs(auction));
      return;
    }

    const attempt = {
      id: crypto.randomUUID(),
      key: decisionKey,
      amount,
      basedOnBid: currentBid,
      basedOnBidderId: currentBidderId || null,
      preparedAt: new Date().toISOString(),
      completedAt: null,
      outcome: "prepared",
      httpStatus: null,
      error: null
    };

    fresh.attempts = Array.isArray(fresh.attempts) ? fresh.attempts : [];
    fresh.attempts.push(attempt);
    fresh.attempts = fresh.attempts.slice(-100);
    addAttemptKey(fresh, decisionKey);
    fresh.lastAction = "bid-prepared";
    addEvent(fresh, {
      action: "bid-prepared",
      attemptId: attempt.id,
      currentBid,
      amount
    });

    // Persist dedupe state BEFORE the POST. From this point onward this exact
    // decision key is never automatically retried, even if the POST result is
    // ambiguous because of a timeout/network failure.
    await this.ctx.storage.put("autoBid", fresh);

    const result = await postBidOnce(credentials, fresh.listingId, amount);

    // Merge the result into the newest state so a concurrent stop/max update is
    // not overwritten by this alarm.
    state = await this.ctx.storage.get("autoBid");
    if (!state) return;

    const savedAttempt = Array.isArray(state.attempts)
      ? state.attempts.find(x => x.id === attempt.id)
      : null;

    if (savedAttempt) {
      savedAttempt.completedAt = new Date().toISOString();
      savedAttempt.outcome = result.outcome;
      savedAttempt.httpStatus = result.httpStatus;
      savedAttempt.error = result.error || null;
    }

    if (Number.isFinite(result.balance)) {
      state.lastBalance = result.balance;
    }

    if (result.outcome === "accepted") {
      state.lastAction = "bid-accepted";
      addEvent(state, {
        action: "bid-accepted",
        attemptId: attempt.id,
        amount,
        httpStatus: result.httpStatus
      });
    } else if (result.outcome === "rejected") {
      state.lastAction = "bid-rejected-no-retry";
      addEvent(state, {
        action: "bid-rejected-no-retry",
        attemptId: attempt.id,
        amount,
        httpStatus: result.httpStatus,
        error: result.error || null
      });
    } else {
      state.lastAction = "bid-ambiguous-no-retry";
      addEvent(state, {
        action: "bid-ambiguous-no-retry",
        attemptId: attempt.id,
        amount,
        error: result.error || null
      });
    }

    await this.ctx.storage.put("autoBid", state);

    if (state.enabled && !state.stoppedAt && !state.finishedAt) {
      // Reconcile by GET on the next cycle. Never repeat the just-attempted
      // POST merely because its response was rejected or ambiguous.
      await this.ctx.storage.setAlarm(Date.now() + 2000);
    }
  }
}
