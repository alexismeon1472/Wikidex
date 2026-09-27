import { DurableObject } from "cloudflare:workers";
import { renderAppHtml } from "./ui.js";
import { resolveAccountCredentials, searchCards, collectionPage, marketplacePage, getWishlist, addWishlistCard, buildPriorityMarketSnapshot, scanPriorityMarketChunk, analyzeCommonCleanup, discardUserCardOnce, probeCardPricing, discoverMyActiveBids } from "./wikimasters.js";
export { AutoBidEngine } from "./autobid.js";
export { UserRegistry, UserAccount } from "./accounts.js";

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

function htmlResponse() {
  return new Response(renderAppHtml(), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy":
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; " +
        "img-src 'self' data: https:; " +
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    }
  });
}

function registryStub(env) {
  return env.USER_REGISTRY.get(
    env.USER_REGISTRY.idFromName("wikidex-user-registry")
  );
}

function userAccountStub(env, accountId) {
  return env.USER_ACCOUNT.get(
    env.USER_ACCOUNT.idFromName(String(accountId))
  );
}

function userEngineStub(env, accountId, listingId) {
  return env.AUTOBID_ENGINE.get(
    env.AUTOBID_ENGINE.idFromName(String(accountId) + ":" + String(listingId))
  );
}

function requireAdminKey(request, env) {
  if (!env.ADMIN_KEY) {
    return json({
      ok: false,
      error: "ADMIN_KEY is not configured."
    }, 503);
  }

  const supplied = request.headers.get("x-wikidex-admin-key") || "";
  if (!safeEqual(supplied, env.ADMIN_KEY)) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  return null;
}

async function authenticateUser(request, env) {
  const raw = request.headers.get("authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() || "";

  if (!token) {
    return {
      error: json({ ok: false, error: "Unauthorized." }, 401),
      account: null
    };
  }

  const response = await registryStub(env).fetch(
    new Request("https://registry.internal/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    })
  );

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.account) {
    return {
      error: json({ ok: false, error: "Unauthorized." }, 401),
      account: null
    };
  }

  return { error: null, account: data.account };
}

async function accountSessionStatus(env, accountId) {
  const response = await userAccountStub(env, accountId)
    .fetch("https://account.internal/status");

  return response.json().catch(() => ({
    ok: false,
    connected: false
  }));
}

async function accountAutoBidRefs(env, accountId) {
  const response = await userAccountStub(env, accountId)
    .fetch("https://account.internal/autobids");

  const data = await response.json().catch(() => null);
  return Array.isArray(data?.listings) ? data.listings : [];
}

async function accountAutoBidCache(env, accountId) {
  const response = await userAccountStub(env, accountId)
    .fetch("https://account.internal/autobids/cache");

  const data = await response.json().catch(() => null);
  return data?.cache && typeof data.cache === "object"
    ? data.cache
    : {};
}

async function cacheAccountAutoBidState(env, accountId, listingId, state) {
  try {
    await userAccountStub(env, accountId).fetch(
      new Request("https://account.internal/autobids/cache", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId,
          state
        })
      })
    );
  } catch {}
}

async function runningAccountAutoBids(env, accountId) {
  const refs = await accountAutoBidRefs(env, accountId);
  const running = [];

  for (const listingId of refs) {
    try {
      const response = await userEngineStub(env, accountId, listingId)
        .fetch("https://autobid.internal/status");
      const data = await response.json().catch(() => null);
      if (data?.running) running.push(listingId);
    } catch {}
  }

  return running;
}

async function stopAllAccountAutoBids(env, accountId) {
  const refs = await accountAutoBidRefs(env, accountId);

  for (const listingId of refs) {
    try {
      await userEngineStub(env, accountId, listingId)
        .fetch("https://autobid.internal/stop", { method: "POST" });
    } catch {}
  }
}

async function putMarketScanSnapshot(env, accountId, snapshot) {
  const response = await userAccountStub(env, accountId).fetch(
    new Request("https://account.internal/market-scan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot)
    })
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to save market scan.");
  }
}

async function getMarketScanSnapshot(env, accountId) {
  const response = await userAccountStub(env, accountId)
    .fetch("https://account.internal/market-scan");
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.snapshot) {
    throw new Error(data?.error || "No market scan snapshot.");
  }

  return data.snapshot;
}

async function putCleanupPlan(env, accountId, plan) {
  const response = await userAccountStub(env, accountId).fetch(
    new Request("https://account.internal/cleanup-plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plan)
    })
  );

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "Unable to save cleanup plan.");
  }

  return data;
}

async function getCleanupPlan(env, accountId) {
  const response = await userAccountStub(env, accountId)
    .fetch("https://account.internal/cleanup-plan");
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.plan) {
    throw new Error(data?.error || "No cleanup plan.");
  }

  return data.plan;
}

async function prepareCleanupAttempt(env, accountId, planId, userCardId) {
  const response = await userAccountStub(env, accountId).fetch(
    new Request("https://account.internal/cleanup-prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId, userCardId })
    })
  );

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "Unable to prepare cleanup attempt.");
  }

  return data;
}

async function saveCleanupResult(env, accountId, planId, userCardId, result) {
  const response = await userAccountStub(env, accountId).fetch(
    new Request("https://account.internal/cleanup-result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        planId,
        userCardId,
        outcome: result.outcome,
        httpStatus: result.httpStatus,
        error: result.error || null,
        balance: result.balance
      })
    })
  );

  return response.ok;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function addAccountAutoBidRef(env, accountId, listingId) {
  await userAccountStub(env, accountId).fetch(
    new Request("https://account.internal/autobids/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listingId })
    })
  );
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


function normalizeListingId(value) {
  const match = String(value || "").match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return match ? match[0].toLowerCase() : null;
}

async function probeAuctionRead(env, listingId) {
  const id = normalizeListingId(listingId);
  if (!id) {
    return json({ ok: false, error: "Invalid listing id." }, 400);
  }

  if (!env.WIKIMASTERS_COOKIE) {
    return json({
      ok: false,
      error: "WIKIMASTERS_COOKIE is not configured."
    }, 503);
  }

  let upstream;
  try {
    upstream = await fetch(
      "https://www.wiki-masters.com/api/marketplace/" + encodeURIComponent(id),
      {
        method: "GET",
        headers: {
          accept: "application/json, text/plain, */*",
          cookie: env.WIKIMASTERS_COOKIE,
          origin: "https://www.wiki-masters.com",
          referer: "https://www.wiki-masters.com/marketplace"
        },
        redirect: "manual"
      }
    );
  } catch (error) {
    return json({
      ok: false,
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

  const auction = data?.auction || data || null;

  if (!upstream.ok || !auction || typeof auction !== "object") {
    return json({
      ok: false,
      listingId: id,
      upstreamStatus: upstream.status,
      upstreamContentType: contentType || null,
      error: "Auction read failed."
    }, 502);
  }

  const currentBid = Number(
    auction.current_bid ??
    auction.currentBid ??
    auction.base_amount ??
    auction.baseAmount ??
    0
  );

  return json({
    ok: true,
    listingId: id,
    upstreamStatus: upstream.status,
    title:
      auction?.card?.wikipedia_title ||
      auction?.snapshot_search_document ||
      null,
    status: auction.status || null,
    currentBid: Number.isFinite(currentBid) ? currentBid : null,
    endAt: auction.end_at || auction.endAt || null,
    hasCurrentBidder: !!(auction.current_bidder_id || auction.currentBidderId),
    closed: ["settled_sold","settled_unsold","sold","closed","expired","cancelled","canceled","ended","settled"]
      .includes(String(auction.status || "").toLowerCase())
  });
}


function wdDryNextBid(base) {
  const n = Number(base);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.max(
    Math.ceil(n * 1.10),
    Math.floor(n) + 1
  );
}

function wdDryClosed(auction) {
  const status = String(auction?.status || "").toLowerCase();
  if ([
    "settled_sold","settled_unsold","sold","closed","expired",
    "cancelled","canceled","ended","settled"
  ].includes(status)) return true;

  const end = Date.parse(auction?.end_at || auction?.endAt || "");
  return Number.isFinite(end) && end <= Date.now();
}

async function wdDryFetchAuction(env, listingId) {
  const response = await fetch(
    "https://www.wiki-masters.com/api/marketplace/" + encodeURIComponent(listingId),
    {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        cookie: env.WIKIMASTERS_COOKIE || "",
        origin: "https://www.wiki-masters.com",
        referer: "https://www.wiki-masters.com/marketplace"
      },
      redirect: "manual"
    }
  );

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok) {
    throw new Error("Auction GET failed with HTTP " + response.status);
  }

  const auction = data?.auction || data;
  if (!auction || typeof auction !== "object") {
    throw new Error("Auction response is not valid JSON.");
  }

  return auction;
}

async function wdDryFetchUserId(env) {
  const url = new URL("https://www.wiki-masters.com/api/my-collection");
  url.searchParams.set("sort", "rarity");
  url.searchParams.set("rarity", "C");
  url.searchParams.set("page", "0");
  url.searchParams.set("stats", "0");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      cookie: env.WIKIMASTERS_COOKIE || "",
      origin: "https://www.wiki-masters.com",
      referer: "https://www.wiki-masters.com/"
    },
    redirect: "manual"
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return htmlResponse();
    }

    if (url.pathname === "/api/admin/users") {
      const denied = requireAdminKey(request, env);
      if (denied) return denied;

      if (request.method === "POST") {
        let body = {};
        try { body = await request.json(); } catch {}

        const response = await registryStub(env).fetch(
          new Request("https://registry.internal/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: body.name })
          })
        );

        return new Response(response.body, {
          status: response.status,
          headers: JSON_HEADERS
        });
      }

      if (request.method === "GET") {
        const response = await registryStub(env)
          .fetch("https://registry.internal/list");

        return new Response(response.body, {
          status: response.status,
          headers: JSON_HEADERS
        });
      }

      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      const session = await accountSessionStatus(env, auth.account.accountId);
      return json({
        ok: true,
        account: auth.account,
        session
      });
    }

    if (url.pathname === "/api/session") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      const stub = userAccountStub(env, auth.account.accountId);

      if (request.method === "PUT") {
        const running = await runningAccountAutoBids(
          env,
          auth.account.accountId
        );

        if (running.length) {
          return json({
            ok: false,
            error:
              "Arrête les AutoBids actifs avant de remplacer la session WikiMasters.",
            activeAutoBids: running.length
          }, 409);
        }

        let body = {};
        try { body = await request.json(); } catch {}

        const response = await stub.fetch(
          new Request("https://account.internal/session", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              cookie: body.cookie || "",
              authorization: body.authorization || ""
            })
          })
        );

        return new Response(response.body, {
          status: response.status,
          headers: JSON_HEADERS
        });
      }

      if (request.method === "DELETE") {
        await stopAllAccountAutoBids(env, auth.account.accountId);

        const response = await stub.fetch(
          "https://account.internal/session",
          { method: "DELETE" }
        );

        return new Response(response.body, {
          status: response.status,
          headers: JSON_HEADERS
        });
      }

      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    if (url.pathname === "/api/cards/search" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      try {
        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );

        const rarities = url.searchParams
          .getAll("rarity")
          .map(x => String(x || "").toUpperCase());

        const result = await searchCards(credentials, {
          q: url.searchParams.get("q") || "",
          page: Number(url.searchParams.get("page") || 0),
          rarities
        });

        return json(result);
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/collection" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      try {
        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );

        const result = await collectionPage(credentials, {
          page: Number(url.searchParams.get("page") || 0),
          rarity: url.searchParams.get("rarity") || ""
        });

        return json(result);
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/wishlist" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      try {
        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );
        return json(await getWishlist(credentials));
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/wishlist" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      let body = {};
      try { body = await request.json(); } catch {}

      try {
        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );
        return json(await addWishlistCard(credentials, body.cardId));
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/marketplace/priority/start" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      try {
        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );

        const snapshot = await buildPriorityMarketSnapshot(credentials);
        await putMarketScanSnapshot(env, auth.account.accountId, snapshot);

        return json({
          ok: true,
          scanId: snapshot.scanId,
          wishlistCount: snapshot.wishlistCount,
          createdAt: new Date(snapshot.createdAt).toISOString()
        });
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/marketplace/priority" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      try {
        const snapshot = await getMarketScanSnapshot(
          env,
          auth.account.accountId
        );

        const scanId = String(url.searchParams.get("scan") || "");
        if (!scanId || scanId !== snapshot.scanId) {
          return json({ ok: false, error: "Market scan mismatch." }, 409);
        }

        if (Date.now() - Number(snapshot.createdAt || 0) > 15 * 60_000) {
          return json({
            ok: false,
            error: "Le scan marché a expiré. Relance l'analyse wishlist."
          }, 410);
        }

        const offset = Math.max(
          0,
          Math.floor(Number(url.searchParams.get("offset") || 0) / 50) * 50
        );

        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );

        const result = await scanPriorityMarketChunk(credentials, {
          wishlistCardIds: snapshot.wishlistCardIds,
          userId: snapshot.userId,
          offset
        });

        return json({
          ok: true,
          scanId,
          offset,
          scannedListings: result.scannedListings,
          failedSegments: result.failedSegments,
          recovered: result.recovered,
          wishlistListings: result.wishlistListings,
          ownedExcluded: result.ownedExcluded,
          matches: result.matches,
          nextOffset: result.nextOffset
        });
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/cleanup/analyze" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      let body = {};
      try { body = await request.json(); } catch {}

      try {
        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );

        const analysis = await analyzeCommonCleanup(credentials, {
          protectStarred: body.protectStarred !== false
        });

        const planId = crypto.randomUUID();
        const createdAt = Date.now();

        await putCleanupPlan(env, auth.account.accountId, {
          planId,
          createdAt,
          protectStarred: analysis.protectStarred,
          summary: {
            scanned: analysis.scanned,
            pagesRead: analysis.pagesRead,
            wishlistCount: analysis.wishlistCount,
            protectedWishlist: analysis.protectedWishlist,
            protectedPending: analysis.protectedPending,
            protectedStarred: analysis.protectedStarred,
            discardable: analysis.candidates.length
          },
          items: analysis.candidates
        });

        return json({
          ok: true,
          planId,
          createdAt: new Date(createdAt).toISOString(),
          ...analysis
        });
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/cleanup/execute" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      if (String(env.CLEANUP_WRITES_ENABLED || "").toLowerCase() !== "true") {
        return json({
          ok: false,
          error:
            "Le verrou global de défausse est désactivé. CLEANUP_WRITES_ENABLED doit valoir true."
        }, 503);
      }

      let body = {};
      try { body = await request.json(); } catch {}

      if (body.confirm !== "DISCARD_COMMONS") {
        return json({
          ok: false,
          error: 'Confirmation explicite requise: "DISCARD_COMMONS".'
        }, 400);
      }

      const planId = String(body.planId || "");
      if (!planId) {
        return json({ ok: false, error: "planId requis." }, 400);
      }

      try {
        const accountId = auth.account.accountId;
        let plan = await getCleanupPlan(env, accountId);

        if (plan.planId !== planId) {
          return json({ ok: false, error: "Cleanup plan mismatch." }, 409);
        }

        if (Date.now() - Number(plan.createdAt || 0) > 15 * 60_000) {
          return json({
            ok: false,
            error: "Le plan de nettoyage a expiré. Relance l'analyse."
          }, 410);
        }

        const batchSize = Math.max(
          1,
          Math.min(20, Math.round(Number(body.batchSize) || 10))
        );

        const attempted = plan.attempted || {};
        const pending = plan.items.filter(
          item => !attempted[String(item.userCardId || "")]
        ).slice(0, batchSize);

        if (!pending.length) {
          return json({
            ok: true,
            complete: true,
            processed: 0,
            remaining: 0,
            results: plan.results || []
          });
        }

        const credentials = await resolveAccountCredentials(env, accountId);
        const results = [];
        let consecutiveFailures = Number(plan.consecutiveFailures) || 0;

        if (consecutiveFailures >= 3) {
          return json({
            ok: true,
            complete: false,
            processed: 0,
            remaining: pending.length,
            stoppedAfterFailures: true,
            results: []
          });
        }

        for (const item of pending) {
          const userCardId = String(item.userCardId || "");
          const prepared = await prepareCleanupAttempt(
            env,
            accountId,
            planId,
            userCardId
          );

          if (!prepared.allowed) continue;

          const result = await discardUserCardOnce(
            credentials,
            userCardId
          );

          await saveCleanupResult(
            env,
            accountId,
            planId,
            userCardId,
            result
          );

          results.push({
            userCardId,
            title: item.title,
            ...result
          });

          if (result.outcome === "accepted") {
            consecutiveFailures = 0;
          } else {
            consecutiveFailures++;
          }

          if (consecutiveFailures >= 3) break;
          await delay(250);
        }

        plan = await getCleanupPlan(env, accountId);
        const attemptedCount = Object.keys(plan.attempted || {}).length;
        const remaining = Math.max(0, plan.items.length - attemptedCount);

        return json({
          ok: true,
          complete: remaining === 0,
          processed: results.length,
          remaining,
          stoppedAfterFailures: consecutiveFailures >= 3,
          results
        });
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/marketplace" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      try {
        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );

        return json(await marketplacePage(credentials, {
          page: Number(url.searchParams.get("page") || 1),
          limit: Number(url.searchParams.get("limit") || 50),
          sort: url.searchParams.get("sort") || "recent"
        }));
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/pricing/probe" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      const listingId = normalizeListingId(
        url.searchParams.get("listing")
      );
      const cardId = String(
        url.searchParams.get("card") || ""
      ).trim();

      if (!listingId && !cardId) {
        return json({
          ok: false,
          error: "listing ou card requis."
        }, 400);
      }

      try {
        const credentials = await resolveAccountCredentials(
          env,
          auth.account.accountId
        );

        return json(await probeCardPricing(credentials, {
          listingId: listingId || "",
          cardId
        }));
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/autobids" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      const accountId = auth.account.accountId;
      const liveOnly = url.searchParams.get("live") === "1";
      const refs = await accountAutoBidRefs(env, accountId);
      const cache = await accountAutoBidCache(env, accountId);
      const items = [];

      for (const listingId of refs) {
        const cached = cache[listingId] || null;

        // Archived rows never change again. During automatic UI refreshes,
        // paused rows are cached too because their engine has no alarm.
        if (
          cached &&
          (
            cached.archived ||
            (
              liveOnly &&
              !cached.running
            )
          )
        ) {
          items.push(cached);
          continue;
        }

        try {
          const response = await userEngineStub(env, accountId, listingId)
            .fetch("https://autobid.internal/status");
          const data = await response.json();

          const state = {
            listingId,
            ...data
          };

          items.push(state);
          await cacheAccountAutoBidState(
            env,
            accountId,
            listingId,
            state
          );
        } catch (error) {
          const fallback = cached || {
            listingId,
            configured: false,
            running: false,
            paused: false,
            archived: false,
            error: error?.message || String(error)
          };

          items.push(fallback);
        }
      }

      return json({
        ok: true,
        liveOnly,
        items
      });
    }

    if (url.pathname === "/api/autobids/sync" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      let body = {};
      try { body = await request.json(); } catch {}

      try {
        const accountId = auth.account.accountId;
        const credentials = await resolveAccountCredentials(env, accountId);
        const discovered = await discoverMyActiveBids(credentials, {
          startPage: Math.max(1, Number(body.startPage) || 1),
          maxPages: 8
        });

        let imported = 0;
        let preservedAutoBids = 0;
        let failed = 0;
        const synced = [];

        for (const auction of discovered.items) {
          const listingId = normalizeListingId(auction.listingId);
          if (!listingId) continue;

          try {
            const stub = userEngineStub(env, accountId, listingId);
            const response = await stub.fetch(
              new Request("https://autobid.internal/track", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  listing: listingId,
                  accountId,
                  userId: discovered.userId
                })
              })
            );

            const data = await response.json().catch(() => null);
            if (!response.ok) {
              failed++;
              continue;
            }

            await addAccountAutoBidRef(env, accountId, listingId);

            try {
              const pricing = await probeCardPricing(credentials, {
                cardId: auction.cardId,
                listingId
              });

              await stub.fetch(
                new Request("https://autobid.internal/reference", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    cardId: pricing.cardId,
                    rarity: pricing.rarity,
                    average: pricing.average
                  })
                })
              );
            } catch {}

            try {
              const latest = await stub.fetch(
                "https://autobid.internal/status"
              );
              const latestData = await latest.json();
              await cacheAccountAutoBidState(
                env,
                accountId,
                listingId,
                {
                  listingId,
                  ...latestData
                }
              );
            } catch {}

            if (data?.preservedAutoBid) preservedAutoBids++;
            else imported++;

            synced.push({
              listingId,
              title: auction.title,
              currentBid: auction.currentBid,
              isHighest: auction.isHighest,
              syncMethod: auction.syncMethod,
              preservedAutoBid: !!data?.preservedAutoBid
            });
          } catch {
            failed++;
          }
        }

        return json({
          ok: true,
          found: discovered.items.length,
          imported,
          preservedAutoBids,
          failed,
          startPage: discovered.startPage,
          pagesRead: discovered.pagesRead,
          scannedListings: discovered.scannedListings,
          failedPages: discovered.failedPages,
          nextPage: discovered.nextPage,
          finished: discovered.finished,
          synced
        });
      } catch (error) {
        return json({
          ok: false,
          error: error?.message || String(error)
        }, 502);
      }
    }

    if (url.pathname === "/api/autobids/pause" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      const listingId = normalizeListingId(url.searchParams.get("listing"));
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      return userEngineStub(env, auth.account.accountId, listingId)
        .fetch("https://autobid.internal/pause", { method: "POST" });
    }

    if (url.pathname === "/api/autobids/resume" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      const listingId = normalizeListingId(url.searchParams.get("listing"));
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      let body = {};
      try { body = await request.json(); } catch {}

      return userEngineStub(env, auth.account.accountId, listingId).fetch(
        new Request("https://autobid.internal/resume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            confirm: body.confirm || ""
          })
        })
      );
    }

    if (url.pathname === "/api/autobids/start" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      let body = {};
      try { body = await request.json(); } catch {}

      const listingId = normalizeListingId(body.listing);
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      const accountId = auth.account.accountId;
      const response = await userEngineStub(env, accountId, listingId).fetch(
        new Request("https://autobid.internal/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listing: listingId,
            max: body.max,
            confirm: body.confirm,
            accountId
          })
        })
      );

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return json(data || { ok: false, error: "AutoBid start failed." }, response.status);
      }

      await addAccountAutoBidRef(env, accountId, listingId);

      const stub = userEngineStub(env, accountId, listingId);

      try {
        const supplied = body.pricing;
        const suppliedAverage =
          supplied?.average === null ||
          supplied?.average === undefined ||
          supplied?.average === ""
            ? NaN
            : Number(supplied.average);

        let pricing = null;

        if (
          supplied?.cardId &&
          Number.isFinite(suppliedAverage)
        ) {
          pricing = {
            cardId: String(supplied.cardId),
            rarity: supplied.rarity
              ? String(supplied.rarity).toUpperCase()
              : null,
            average: suppliedAverage
          };
        } else {
          const credentials = await resolveAccountCredentials(env, accountId);
          pricing = await probeCardPricing(credentials, {
            listingId
          });
        }

        await stub.fetch(
          new Request("https://autobid.internal/reference", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              cardId: pricing.cardId,
              rarity: pricing.rarity,
              average: pricing.average
            })
          })
        );
      } catch {}

      try {
        const latest = await stub.fetch(
          "https://autobid.internal/status"
        );
        const latestData = await latest.json();

        await cacheAccountAutoBidState(
          env,
          accountId,
          listingId,
          {
            listingId,
            ...latestData
          }
        );

        return json({
          ...data,
          cardId: latestData.cardId || null,
          rarity: latestData.rarity || null,
          imageUrl: latestData.imageUrl || null,
          average: latestData.average ?? null
        });
      } catch {}

      return json(data);
    }

    if (url.pathname === "/api/autobids/status" && request.method === "GET") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      const listingId = normalizeListingId(url.searchParams.get("listing"));
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      return userEngineStub(env, auth.account.accountId, listingId)
        .fetch("https://autobid.internal/status");
    }

    if (url.pathname === "/api/autobids/stop" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      const listingId = normalizeListingId(url.searchParams.get("listing"));
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      return userEngineStub(env, auth.account.accountId, listingId)
        .fetch("https://autobid.internal/stop", { method: "POST" });
    }

    if (url.pathname === "/api/autobids/max" && request.method === "POST") {
      const auth = await authenticateUser(request, env);
      if (auth.error) return auth.error;

      let body = {};
      try { body = await request.json(); } catch {}

      const listingId = normalizeListingId(body.listing);
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      return userEngineStub(env, auth.account.accountId, listingId).fetch(
        new Request("https://autobid.internal/max", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ max: body.max })
        })
      );
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "wikidex-cloud-poc",
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/probe/auction") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      return probeAuctionRead(env, url.searchParams.get("listing"));
    }

    if (url.pathname === "/probe/auth") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      return probeWikiMastersAuth(env);
    }


    if (url.pathname === "/probe/dryrun/start") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      let body = {};
      try { body = await request.json(); } catch {}

      const listingId = normalizeListingId(body.listing);
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      const stub = env.AUTOBID_DRYRUN.get(
        env.AUTOBID_DRYRUN.idFromName(listingId)
      );

      return stub.fetch(new Request("https://dryrun.internal/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, listing: listingId })
      }));
    }

    if (url.pathname === "/probe/dryrun/status") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      const listingId = normalizeListingId(url.searchParams.get("listing"));
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      const stub = env.AUTOBID_DRYRUN.get(
        env.AUTOBID_DRYRUN.idFromName(listingId)
      );

      return stub.fetch("https://dryrun.internal/status");
    }

    if (url.pathname === "/probe/dryrun/stop") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      const listingId = normalizeListingId(url.searchParams.get("listing"));
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      const stub = env.AUTOBID_DRYRUN.get(
        env.AUTOBID_DRYRUN.idFromName(listingId)
      );

      return stub.fetch("https://dryrun.internal/stop", { method: "POST" });
    }

    if (url.pathname === "/autobid/start") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      let body = {};
      try { body = await request.json(); } catch {}

      const listingId = normalizeListingId(body.listing);
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      const stub = env.AUTOBID_ENGINE.get(
        env.AUTOBID_ENGINE.idFromName(listingId)
      );

      return stub.fetch(new Request("https://autobid.internal/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, listing: listingId })
      }));
    }

    if (url.pathname === "/autobid/status") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      const listingId = normalizeListingId(url.searchParams.get("listing"));
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      const stub = env.AUTOBID_ENGINE.get(
        env.AUTOBID_ENGINE.idFromName(listingId)
      );

      return stub.fetch("https://autobid.internal/status");
    }

    if (url.pathname === "/autobid/stop") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      const listingId = normalizeListingId(url.searchParams.get("listing"));
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      const stub = env.AUTOBID_ENGINE.get(
        env.AUTOBID_ENGINE.idFromName(listingId)
      );

      return stub.fetch("https://autobid.internal/stop", { method: "POST" });
    }

    if (url.pathname === "/autobid/max") {
      const denied = requireProbeKey(request, env);
      if (denied) return denied;

      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      let body = {};
      try { body = await request.json(); } catch {}

      const listingId = normalizeListingId(body.listing);
      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      const stub = env.AUTOBID_ENGINE.get(
        env.AUTOBID_ENGINE.idFromName(listingId)
      );

      return stub.fetch(new Request("https://autobid.internal/max", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ max: body.max })
      }));
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
        "GET /probe/auction?listing=<uuid>",
        "POST /probe/dryrun/start",
        "GET /probe/dryrun/status?listing=<uuid>",
        "POST /probe/dryrun/stop?listing=<uuid>",
        "POST /autobid/start",
        "GET /autobid/status?listing=<uuid>",
        "POST /autobid/stop?listing=<uuid>",
        "POST /autobid/max",
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


export class AutoBidDryRun extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/start" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}

      const listingId = normalizeListingId(body.listing);
      const max = Number(body.max);
      const intervalMs = Math.max(
        1000,
        Math.min(60_000, Math.round(Number(body.intervalMs) || 2000))
      );
      const requestedTicks = Math.max(
        1,
        Math.min(300, Math.round(Number(body.count) || 30))
      );

      if (!listingId) {
        return json({ ok: false, error: "Invalid listing id." }, 400);
      }

      if (!Number.isFinite(max) || max <= 0) {
        return json({ ok: false, error: "Invalid max amount." }, 400);
      }

      if (!this.env.WIKIMASTERS_COOKIE) {
        return json({ ok: false, error: "WIKIMASTERS_COOKIE is missing." }, 503);
      }

      const userId = await wdDryFetchUserId(this.env);
      const auction = await wdDryFetchAuction(this.env, listingId);

      const state = {
        listingId,
        max,
        intervalMs,
        requestedTicks,
        userId,
        startedAt: Date.now(),
        finishedAt: null,
        stoppedAt: null,
        ticks: 0,
        reads: 0,
        readErrors: 0,
        lastWouldBidKey: null,
        title:
          auction?.card?.wikipedia_title ||
          auction?.snapshot_search_document ||
          null,
        endAt: auction?.end_at || auction?.endAt || null,
        events: []
      };

      await this.ctx.storage.put("dryRun", state);
      await this.ctx.storage.setAlarm(Date.now() + intervalMs);

      return json({
        ok: true,
        dryRun: true,
        listingId,
        title: state.title,
        max,
        intervalMs,
        requestedTicks,
        endAt: state.endAt,
        note: "Read-only simulation. This code never sends POST /bid."
      });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const state = await this.ctx.storage.get("dryRun");

      if (!state) {
        return json({
          ok: true,
          running: false,
          message: "No dry-run exists for this listing."
        });
      }

      return json({
        ok: true,
        dryRun: true,
        running: !state.finishedAt && !state.stoppedAt,
        listingId: state.listingId,
        title: state.title,
        max: state.max,
        intervalMs: state.intervalMs,
        requestedTicks: state.requestedTicks,
        ticks: state.ticks,
        reads: state.reads,
        readErrors: state.readErrors,
        endAt: state.endAt,
        startedAt: new Date(state.startedAt).toISOString(),
        finishedAt: state.finishedAt
          ? new Date(state.finishedAt).toISOString()
          : null,
        stoppedAt: state.stoppedAt
          ? new Date(state.stoppedAt).toISOString()
          : null,
        events: state.events.slice(-40)
      });
    }

    if (url.pathname === "/stop" && request.method === "POST") {
      const state = await this.ctx.storage.get("dryRun");
      if (!state) return json({ ok: true, stopped: false });

      state.stoppedAt = Date.now();
      await this.ctx.storage.put("dryRun", state);
      await this.ctx.storage.deleteAlarm();

      return json({ ok: true, stopped: true });
    }

    return json({ ok: false, error: "Dry-run route not found." }, 404);
  }

  async alarm() {
    const state = await this.ctx.storage.get("dryRun");
    if (!state || state.finishedAt || state.stoppedAt) return;

    const now = Date.now();
    state.ticks++;

    try {
      const auction = await wdDryFetchAuction(this.env, state.listingId);
      state.reads++;

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

      const closed = wdDryClosed(auction);
      const highest = !!(
        state.userId &&
        currentBidderId &&
        String(currentBidderId) === String(state.userId)
      );

      const nextBid = wdDryNextBid(currentBid);
      const withinCap = Number.isFinite(nextBid) && nextBid <= state.max;

      let action = "observe";
      let wouldBid = false;

      if (closed) {
        action = "closed";
      } else if (highest) {
        action = "already-highest";
      } else if (!withinCap) {
        action = "cap-reached";
      } else {
        const key = state.listingId + ":" + currentBid + ":" + nextBid;
        if (key !== state.lastWouldBidKey) {
          action = "would-bid";
          wouldBid = true;
          state.lastWouldBidKey = key;
        } else {
          action = "same-state-no-repeat";
        }
      }

      state.events.push({
        at: new Date(now).toISOString(),
        currentBid: Number.isFinite(currentBid) ? currentBid : null,
        nextBid,
        max: state.max,
        highest,
        wouldBid,
        action,
        status: auction.status || null
      });

      state.events = state.events.slice(-80);

      if (closed || state.ticks >= state.requestedTicks) {
        state.finishedAt = now;
        await this.ctx.storage.put("dryRun", state);
        return;
      }
    } catch (error) {
      state.readErrors++;
      state.events.push({
        at: new Date(now).toISOString(),
        action: "read-error",
        error: error?.message || String(error)
      });
      state.events = state.events.slice(-80);
    }

    await this.ctx.storage.put("dryRun", state);
    await this.ctx.storage.setAlarm(Date.now() + state.intervalMs);
  }
}
