import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const SUPABASE_URL = "https://cyrxjeppjqsxxjayfrur.supabase.co";
const SUPABASE_PROJECT = "cyrxjeppjqsxxjayfrur";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}

function base64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "wdx_" + base64Url(bytes);
}

async function vaultKey(secret) {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(secret || ""))
  );

  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function sealJson(secret, value) {
  if (!secret) throw new Error("VAULT_MASTER_KEY is not configured.");

  const key = await vaultKey(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  return {
    v: 1,
    iv: base64Url(iv),
    data: base64Url(new Uint8Array(encrypted))
  };
}

function decodeBase64Url(value) {
  let s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";

  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function openJson(secret, sealed) {
  if (!secret) throw new Error("VAULT_MASTER_KEY is not configured.");
  if (!sealed || sealed.v !== 1) throw new Error("Unsupported vault payload.");

  const key = await vaultKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(sealed.iv) },
    key,
    decodeBase64Url(sealed.data)
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}

function decodeBase64UrlText(value) {
  try {
    let s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const binary = atob(s);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function jwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(decodeBase64UrlText(parts[1]));
  } catch {
    return null;
  }
}

function findSupabaseSession(value, depth = 0) {
  if (depth > 8 || value == null) {
    return { accessToken: null, refreshToken: null };
  }

  if (typeof value === "string") {
    const text = value.trim();

    if (text.startsWith("base64-")) {
      const decoded = decodeBase64UrlText(text.slice(7));
      if (decoded) {
        const found = findSupabaseSession(decoded, depth + 1);
        if (found.accessToken || found.refreshToken) return found;
      }
    }

    try {
      const decoded = decodeURIComponent(text);
      if (decoded !== text) {
        const found = findSupabaseSession(decoded, depth + 1);
        if (found.accessToken || found.refreshToken) return found;
      }
    } catch {}

    if (
      (text.startsWith("{") && text.endsWith("}")) ||
      (text.startsWith("[") && text.endsWith("]"))
    ) {
      try {
        return findSupabaseSession(JSON.parse(text), depth + 1);
      } catch {}
    }

    if (/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
      return {
        accessToken: text,
        refreshToken: null
      };
    }

    return { accessToken: null, refreshToken: null };
  }

  if (Array.isArray(value)) {
    let accessToken = null;
    let refreshToken = null;

    for (const item of value) {
      const found = findSupabaseSession(item, depth + 1);
      accessToken ||= found.accessToken;
      refreshToken ||= found.refreshToken;
    }

    return { accessToken, refreshToken };
  }

  if (typeof value === "object") {
    const accessToken =
      typeof value.access_token === "string" ? value.access_token :
      typeof value.accessToken === "string" ? value.accessToken :
      null;

    const refreshToken =
      typeof value.refresh_token === "string" ? value.refresh_token :
      typeof value.refreshToken === "string" ? value.refreshToken :
      null;

    if (accessToken || refreshToken) {
      return { accessToken, refreshToken };
    }

    let nestedAccess = null;
    let nestedRefresh = null;

    for (const item of Object.values(value)) {
      const found = findSupabaseSession(item, depth + 1);
      nestedAccess ||= found.accessToken;
      nestedRefresh ||= found.refreshToken;
    }

    return {
      accessToken: nestedAccess,
      refreshToken: nestedRefresh
    };
  }

  return { accessToken: null, refreshToken: null };
}

function authCookieValue(cookieHeader) {
  const parts = String(cookieHeader || "")
    .split(";")
    .map(x => x.trim())
    .filter(Boolean)
    .map(part => {
      const i = part.indexOf("=");
      return i < 0
        ? { name: part, value: "" }
        : {
            name: part.slice(0, i),
            value: part.slice(i + 1)
          };
    });

  const prefix = "sb-" + SUPABASE_PROJECT + "-auth-token";
  const direct = parts.find(x => x.name === prefix)?.value || "";
  const chunks = parts
    .filter(x => x.name.startsWith(prefix + "."))
    .sort((a, b) => {
      const ai = Number(a.name.match(/\.(\d+)$/)?.[1] || 0);
      const bi = Number(b.name.match(/\.(\d+)$/)?.[1] || 0);
      return ai - bi;
    });

  return chunks.length
    ? chunks.map(x => x.value).join("")
    : direct;
}

function extractSupabaseSession(credentials) {
  const stored = credentials?.supabaseSession || {};

  let accessToken =
    stored.accessToken ||
    stored.access_token ||
    null;

  let refreshToken =
    stored.refreshToken ||
    stored.refresh_token ||
    null;

  if (!accessToken || !refreshToken) {
    const cookieSession = findSupabaseSession(
      authCookieValue(credentials?.cookie || "")
    );

    accessToken ||= cookieSession.accessToken;
    refreshToken ||= cookieSession.refreshToken;
  }

  if (!accessToken && credentials?.authorization) {
    const authorization = String(credentials.authorization)
      .replace(/^Bearer\s+/i, "")
      .trim();

    const authSession = findSupabaseSession(authorization);
    accessToken ||= authSession.accessToken;
    refreshToken ||= authSession.refreshToken;
  }

  const payload = jwtPayload(accessToken);

  return {
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
    userId:
      stored.userId ||
      stored.user_id ||
      payload?.sub ||
      null,
    expiresAt:
      Number(stored.expiresAt || stored.expires_at) ||
      Number(payload?.exp) ||
      null,
    refreshedAt: stored.refreshedAt || null
  };
}

function supabaseAccessNeedsRefresh(session, skewSeconds = 60) {
  if (!session?.accessToken) return true;

  const payload = jwtPayload(session.accessToken);
  const exp = Number(session.expiresAt || payload?.exp);
  if (!Number.isFinite(exp)) return false;

  return exp <= Math.floor(Date.now() / 1000) + skewSeconds;
}

async function refreshSupabaseSession(session) {
  if (!session?.refreshToken) {
    throw new Error("Supabase refresh token is missing.");
  }

  const response = await fetch(
    SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: SUPABASE_ANON_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        refresh_token: session.refreshToken
      })
    }
  );

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (
    !response.ok ||
    !data?.access_token ||
    !data?.refresh_token
  ) {
    throw new Error(
      "Supabase refresh failed (HTTP " + response.status + ")."
    );
  }

  const payload = jwtPayload(data.access_token);
  const expiresAt =
    Number(data.expires_at) ||
    (
      Number(data.expires_in)
        ? Math.floor(Date.now() / 1000) + Number(data.expires_in)
        : Number(payload?.exp) || null
    );

  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    userId:
      data?.user?.id ||
      payload?.sub ||
      session.userId ||
      null,
    expiresAt,
    refreshedAt: new Date().toISOString()
  };
}

function wikiHeaders(credentials) {
  const headers = new Headers({
    accept: "application/json, text/plain, */*",
    origin: "https://www.wiki-masters.com",
    referer: "https://www.wiki-masters.com/"
  });

  if (credentials?.cookie) headers.set("cookie", credentials.cookie);
  if (credentials?.authorization) {
    headers.set("authorization", credentials.authorization);
  }

  return headers;
}

async function validateWikiMastersCredentials(credentials) {
  if (!credentials?.cookie && !credentials?.authorization) {
    throw new Error("A WikiMasters cookie or authorization header is required.");
  }

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

  const rows = Array.isArray(data?.collection) ? data.collection : null;
  if (!response.ok || !rows) {
    throw new Error("WikiMasters session validation failed (HTTP " + response.status + ").");
  }

  const userId =
    rows.find(row => row?.user_id)?.user_id ||
    rows.find(row => row?.userId)?.userId ||
    null;

  return {
    userId: userId ? String(userId) : null,
    commonCardsOnFirstPage: rows.length
  };
}

export class UserRegistry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.supabaseRefreshPromise = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/create" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return json({ ok: false, error: "Name is required." }, 400);

      const accountId = crypto.randomUUID();
      const token = randomToken();
      const tokenHash = await sha256(token);
      const now = new Date().toISOString();

      const account = {
        accountId,
        name,
        createdAt: now,
        disabled: false
      };

      await this.ctx.storage.put("token:" + tokenHash, account);
      await this.ctx.storage.put("account:" + accountId, account);

      return json({
        ok: true,
        account,
        token,
        note: "This user token is shown only once."
      });
    }

    if (url.pathname === "/lookup" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const token = String(body.token || "");
      if (!token) return json({ ok: false, error: "Unauthorized." }, 401);

      const tokenHash = await sha256(token);
      const account = await this.ctx.storage.get("token:" + tokenHash);

      if (!account || account.disabled) {
        return json({ ok: false, error: "Unauthorized." }, 401);
      }

      return json({ ok: true, account });
    }

    if (url.pathname === "/list" && request.method === "GET") {
      const rows = await this.ctx.storage.list({ prefix: "account:" });
      const accounts = [...rows.values()].sort((a, b) =>
        String(a.createdAt).localeCompare(String(b.createdAt))
      );
      return json({ ok: true, accounts });
    }

    return json({ ok: false, error: "Registry route not found." }, 404);
  }
}

export class UserAccount extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/session" && request.method === "PUT") {
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const credentials = {
        cookie: String(body.cookie || "").trim(),
        authorization: String(body.authorization || "").trim()
      };

      const initialSupabaseSession = extractSupabaseSession(credentials);
      if (
        initialSupabaseSession.accessToken ||
        initialSupabaseSession.refreshToken
      ) {
        credentials.supabaseSession = initialSupabaseSession;
      }

      if (!credentials.cookie && !credentials.authorization) {
        return json({
          ok: false,
          error: "A WikiMasters Cookie or Authorization value is required."
        }, 400);
      }

      let validation;
      try {
        validation = await validateWikiMastersCredentials(credentials);
      } catch (error) {
        return json({
          ok: false,
          connected: false,
          error: error?.message || String(error)
        }, 400);
      }

      const sealed = await sealJson(this.env.VAULT_MASTER_KEY, credentials);
      const profile = {
        connected: true,
        wikiUserId: validation.userId,
        updatedAt: new Date().toISOString()
      };

      await this.ctx.storage.put("wikiCredentials", sealed);
      await this.ctx.storage.put("profile", profile);

      return json({
        ok: true,
        connected: true,
        wikiUserId: validation.userId,
        commonCardsOnFirstPage: validation.commonCardsOnFirstPage,
        updatedAt: profile.updatedAt
      });
    }

    if (url.pathname === "/session" && request.method === "DELETE") {
      await this.ctx.storage.delete("wikiCredentials");
      const profile = {
        connected: false,
        wikiUserId: null,
        updatedAt: new Date().toISOString()
      };
      await this.ctx.storage.put("profile", profile);
      return json({ ok: true, connected: false });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const profile = await this.ctx.storage.get("profile");
      return json({
        ok: true,
        connected: !!profile?.connected,
        wikiUserId: profile?.wikiUserId || null,
        updatedAt: profile?.updatedAt || null
      });
    }

    if (url.pathname === "/credentials" && request.method === "GET") {
      const sealed = await this.ctx.storage.get("wikiCredentials");
      if (!sealed) {
        return json({ ok: false, error: "WikiMasters session is not connected." }, 404);
      }

      try {
        let credentials = await openJson(
          this.env.VAULT_MASTER_KEY,
          sealed
        );

        let session = extractSupabaseSession(credentials);

        if (
          supabaseAccessNeedsRefresh(session) &&
          session.refreshToken
        ) {
          if (!this.supabaseRefreshPromise) {
            this.supabaseRefreshPromise = (async () => {
              const refreshed = await refreshSupabaseSession(session);

              const latestSealed = await this.ctx.storage.get(
                "wikiCredentials"
              );

              let latestCredentials = latestSealed
                ? await openJson(
                    this.env.VAULT_MASTER_KEY,
                    latestSealed
                  )
                : credentials;

              latestCredentials = {
                ...latestCredentials,
                supabaseSession: refreshed
              };

              await this.ctx.storage.put(
                "wikiCredentials",
                await sealJson(
                  this.env.VAULT_MASTER_KEY,
                  latestCredentials
                )
              );

              const profile =
                await this.ctx.storage.get("profile") || {};

              if (
                refreshed.userId &&
                profile.wikiUserId !== refreshed.userId
              ) {
                await this.ctx.storage.put("profile", {
                  ...profile,
                  wikiUserId: refreshed.userId,
                  updatedAt: new Date().toISOString()
                });
              }

              return latestCredentials;
            })().finally(() => {
              this.supabaseRefreshPromise = null;
            });
          }

          try {
            credentials = await this.supabaseRefreshPromise;
            session = extractSupabaseSession(credentials);
          } catch {
            // Keep the original WikiMasters credentials usable for native
            // endpoints. Supabase-only features will surface a specific error.
          }
        } else if (
          !credentials.supabaseSession &&
          (
            session.accessToken ||
            session.refreshToken
          )
        ) {
          credentials = {
            ...credentials,
            supabaseSession: session
          };

          await this.ctx.storage.put(
            "wikiCredentials",
            await sealJson(
              this.env.VAULT_MASTER_KEY,
              credentials
            )
          );
        }

        return json({
          ok: true,
          credentials
        });
      } catch (error) {
        return json({
          ok: false,
          error: "Unable to decrypt WikiMasters session."
        }, 500);
      }
    }

    if (url.pathname === "/push/status" && request.method === "GET") {
      const sealed = await this.ctx.storage.get("pushSubscriptions");
      let subscriptions = [];

      if (sealed) {
        try {
          const decoded = await openJson(
            this.env.VAULT_MASTER_KEY,
            sealed
          );
          subscriptions = Array.isArray(decoded)
            ? decoded
            : [];
        } catch {}
      }

      return json({
        ok: true,
        enabled: subscriptions.length > 0,
        count: subscriptions.length
      });
    }

    if (
      url.pathname === "/push/subscriptions/raw" &&
      request.method === "GET"
    ) {
      const sealed = await this.ctx.storage.get("pushSubscriptions");

      if (!sealed) {
        return json({
          ok: true,
          subscriptions: []
        });
      }

      try {
        const subscriptions = await openJson(
          this.env.VAULT_MASTER_KEY,
          sealed
        );

        return json({
          ok: true,
          subscriptions: Array.isArray(subscriptions)
            ? subscriptions
            : []
        });
      } catch {
        return json({
          ok: false,
          error: "Unable to decrypt push subscriptions."
        }, 500);
      }
    }

    if (
      url.pathname === "/push/subscriptions" &&
      request.method === "POST"
    ) {
      let body = {};
      try { body = await request.json(); } catch {}

      const subscription = body?.subscription || body;
      const endpoint = String(
        subscription?.endpoint || ""
      ).trim();
      const p256dh = String(
        subscription?.keys?.p256dh || ""
      ).trim();
      const auth = String(
        subscription?.keys?.auth || ""
      ).trim();

      let endpointUrl = null;
      try {
        endpointUrl = new URL(endpoint);
      } catch {}

      if (
        !endpointUrl ||
        endpointUrl.protocol !== "https:" ||
        !p256dh ||
        !auth ||
        endpoint.length > 4096 ||
        p256dh.length > 1024 ||
        auth.length > 1024
      ) {
        return json({
          ok: false,
          error: "Invalid Web Push subscription."
        }, 400);
      }

      let subscriptions = [];
      const sealed = await this.ctx.storage.get("pushSubscriptions");

      if (sealed) {
        try {
          const decoded = await openJson(
            this.env.VAULT_MASTER_KEY,
            sealed
          );
          if (Array.isArray(decoded)) subscriptions = decoded;
        } catch {}
      }

      const now = new Date().toISOString();
      const clean = {
        endpoint,
        keys: {
          p256dh,
          auth
        },
        createdAt: now,
        updatedAt: now
      };

      const index = subscriptions.findIndex(
        item => item?.endpoint === endpoint
      );

      if (index >= 0) {
        clean.createdAt =
          subscriptions[index]?.createdAt ||
          now;
        subscriptions[index] = clean;
      } else {
        subscriptions.unshift(clean);
      }

      // A few devices per WikiDex user is enough. Oldest extras are dropped.
      subscriptions = subscriptions
        .slice(0, 10);

      const nextSealed = await sealJson(
        this.env.VAULT_MASTER_KEY,
        subscriptions
      );

      await this.ctx.storage.put(
        "pushSubscriptions",
        nextSealed
      );

      return json({
        ok: true,
        enabled: true,
        count: subscriptions.length
      });
    }

    if (
      url.pathname === "/push/subscriptions" &&
      request.method === "DELETE"
    ) {
      let body = {};
      try { body = await request.json(); } catch {}

      const requested = Array.isArray(body?.endpoints)
        ? body.endpoints
        : body?.endpoint
          ? [body.endpoint]
          : [];

      const endpoints = new Set(
        requested
          .map(value => String(value || "").trim())
          .filter(Boolean)
      );

      const sealed = await this.ctx.storage.get("pushSubscriptions");
      let subscriptions = [];

      if (sealed) {
        try {
          const decoded = await openJson(
            this.env.VAULT_MASTER_KEY,
            sealed
          );
          if (Array.isArray(decoded)) subscriptions = decoded;
        } catch {}
      }

      if (!endpoints.size) {
        subscriptions = [];
      } else {
        subscriptions = subscriptions.filter(
          item => !endpoints.has(item?.endpoint)
        );
      }

      if (subscriptions.length) {
        const nextSealed = await sealJson(
          this.env.VAULT_MASTER_KEY,
          subscriptions
        );
        await this.ctx.storage.put(
          "pushSubscriptions",
          nextSealed
        );
      } else {
        await this.ctx.storage.delete("pushSubscriptions");
      }

      return json({
        ok: true,
        enabled: subscriptions.length > 0,
        count: subscriptions.length
      });
    }

    if (url.pathname === "/market-scan" && request.method === "PUT") {
      let body = {};
      try { body = await request.json(); } catch {}

      if (!body?.scanId || !Array.isArray(body?.wishlistCardIds)) {
        return json({ ok: false, error: "Invalid market scan snapshot." }, 400);
      }

      const snapshot = {
        scanId: String(body.scanId),
        createdAt: Number(body.createdAt) || Date.now(),
        userId: body.userId ? String(body.userId) : null,
        wishlistCount: Number(body.wishlistCount) || 0,
        wishlistCardIds: body.wishlistCardIds.slice(0, 5000)
      };

      await this.ctx.storage.put("marketScan", snapshot);
      return json({ ok: true, scanId: snapshot.scanId });
    }

    if (url.pathname === "/market-scan" && request.method === "GET") {
      const snapshot = await this.ctx.storage.get("marketScan");
      if (!snapshot) {
        return json({ ok: false, error: "No market scan snapshot." }, 404);
      }
      return json({ ok: true, snapshot });
    }

    if (url.pathname === "/market-scan" && request.method === "DELETE") {
      await this.ctx.storage.delete("marketScan");
      return json({ ok: true });
    }

    if (url.pathname === "/cleanup-plan" && request.method === "PUT") {
      let body = {};
      try { body = await request.json(); } catch {}

      if (!body?.planId || !Array.isArray(body?.items)) {
        return json({ ok: false, error: "Invalid cleanup plan." }, 400);
      }

      const plan = {
        planId: String(body.planId),
        createdAt: Number(body.createdAt) || Date.now(),
        protectStarred: body.protectStarred !== false,
        summary: body.summary || {},
        items: body.items.slice(0, 5000),
        attempted: {},
        results: [],
        consecutiveFailures: 0
      };

      await this.ctx.storage.put("cleanupPlan", plan);
      return json({
        ok: true,
        planId: plan.planId,
        itemCount: plan.items.length
      });
    }

    if (url.pathname === "/cleanup-plan" && request.method === "GET") {
      const plan = await this.ctx.storage.get("cleanupPlan");
      if (!plan) {
        return json({ ok: false, error: "No cleanup plan." }, 404);
      }

      return json({
        ok: true,
        plan: {
          planId: plan.planId,
          createdAt: plan.createdAt,
          protectStarred: plan.protectStarred,
          summary: plan.summary,
          items: plan.items,
          attempted: plan.attempted || {},
          results: plan.results || [],
          consecutiveFailures: Number(plan.consecutiveFailures) || 0
        }
      });
    }

    if (url.pathname === "/cleanup-prepare" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}

      const plan = await this.ctx.storage.get("cleanupPlan");
      const planId = String(body.planId || "");
      const userCardId = String(body.userCardId || "");

      if (!plan || plan.planId !== planId) {
        return json({ ok: false, error: "Cleanup plan mismatch." }, 409);
      }

      const candidate = plan.items.find(
        item => String(item.userCardId || "") === userCardId
      );

      if (!candidate) {
        return json({ ok: false, error: "Card is not in this cleanup plan." }, 400);
      }

      plan.attempted = plan.attempted || {};
      if (plan.attempted[userCardId]) {
        return json({
          ok: true,
          allowed: false,
          attempt: plan.attempted[userCardId]
        });
      }

      const attempt = {
        status: "prepared",
        preparedAt: new Date().toISOString()
      };

      // Persist before the destructive POST. A repeated execute call will
      // never be allowed to POST this same owned-card id again.
      plan.attempted[userCardId] = attempt;
      await this.ctx.storage.put("cleanupPlan", plan);

      return json({
        ok: true,
        allowed: true,
        candidate,
        attempt
      });
    }

    if (url.pathname === "/cleanup-result" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}

      const plan = await this.ctx.storage.get("cleanupPlan");
      const planId = String(body.planId || "");
      const userCardId = String(body.userCardId || "");

      if (!plan || plan.planId !== planId) {
        return json({ ok: false, error: "Cleanup plan mismatch." }, 409);
      }

      plan.attempted = plan.attempted || {};
      const current = plan.attempted[userCardId];
      if (!current) {
        return json({ ok: false, error: "Cleanup attempt was not prepared." }, 409);
      }

      const result = {
        userCardId,
        outcome: String(body.outcome || "unknown"),
        httpStatus: Number(body.httpStatus) || 0,
        error: body.error ? String(body.error).slice(0, 240) : null,
        balance: Number.isFinite(Number(body.balance))
          ? Number(body.balance)
          : null,
        completedAt: new Date().toISOString()
      };

      plan.attempted[userCardId] = {
        ...current,
        ...result
      };

      if (result.outcome === "accepted") {
        plan.consecutiveFailures = 0;
      } else {
        plan.consecutiveFailures =
          (Number(plan.consecutiveFailures) || 0) + 1;
      }

      plan.results = Array.isArray(plan.results) ? plan.results : [];
      const oldIndex = plan.results.findIndex(
        x => x.userCardId === userCardId
      );

      if (oldIndex >= 0) plan.results[oldIndex] = result;
      else plan.results.push(result);

      await this.ctx.storage.put("cleanupPlan", plan);

      return json({ ok: true, result });
    }

    if (url.pathname === "/autobids/cache" && request.method === "GET") {
      const cache = await this.ctx.storage.get("autobidCache");
      return json({
        ok: true,
        cache:
          cache && typeof cache === "object"
            ? cache
            : {}
      });
    }

    if (url.pathname === "/autobids/cache" && request.method === "PUT") {
      let body = {};
      try { body = await request.json(); } catch {}

      const listingId = String(body.listingId || "").trim();
      const state = body.state;

      if (!listingId || !state || typeof state !== "object") {
        return json({
          ok: false,
          error: "listingId and state are required."
        }, 400);
      }

      const current = await this.ctx.storage.get("autobidCache");
      const cache =
        current && typeof current === "object"
          ? current
          : {};

      cache[listingId] = {
        listingId,
        configured: state.configured !== false,
        running: !!state.running,
        paused: !!state.paused,
        archived: !!state.archived,
        mode: state.mode || null,
        title: state.title || null,
        cardId: state.cardId || null,
        rarity: state.rarity || null,
        imageUrl: state.imageUrl || null,
        sellerName: state.sellerName || null,
        result: state.result || null,
        finalPrice:
          state.finalPrice !== null &&
          state.finalPrice !== undefined
            ? state.finalPrice
            : null,
        isHighest: !!state.isHighest,
        average:
          state.average !== null &&
          state.average !== undefined
            ? state.average
            : null,
        averageCheckedAt: state.averageCheckedAt || null,
        max:
          state.max !== null &&
          state.max !== undefined
            ? state.max
            : null,
        status: state.status || null,
        currentBid:
          state.currentBid !== null &&
          state.currentBid !== undefined
            ? state.currentBid
            : null,
        nextBid:
          state.nextBid !== null &&
          state.nextBid !== undefined
            ? state.nextBid
            : null,
        endAt: state.endAt || null,
        startedAt: state.startedAt || null,
        stoppedAt: state.stoppedAt || null,
        pausedAt: state.pausedAt || null,
        finishedAt: state.finishedAt || null,
        lastReadAt: state.lastReadAt || null,
        lastAction: state.lastAction || null,
        readErrors: Number(state.readErrors) || 0,
        bidAttempts: Number(state.bidAttempts) || 0,
        lastBalance:
          state.lastBalance !== null &&
          state.lastBalance !== undefined
            ? state.lastBalance
            : null,
        error: state.error || null,
        cachedAt: new Date().toISOString()
      };

      const entries = Object.entries(cache)
        .sort((a, b) =>
          Date.parse(b[1]?.cachedAt || 0) -
          Date.parse(a[1]?.cachedAt || 0)
        )
        .slice(0, 200);

      await this.ctx.storage.put(
        "autobidCache",
        Object.fromEntries(entries)
      );

      return json({
        ok: true,
        state: cache[listingId]
      });
    }

    if (url.pathname === "/autobids" && request.method === "GET") {
      const refs = await this.ctx.storage.get("autobidRefs");
      return json({
        ok: true,
        listings: Array.isArray(refs) ? refs : []
      });
    }

    if (url.pathname === "/autobids/add" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const listingId = String(body.listingId || "").trim();
      if (!listingId) {
        return json({ ok: false, error: "listingId is required." }, 400);
      }

      const refs = await this.ctx.storage.get("autobidRefs");
      const listings = Array.isArray(refs) ? refs : [];

      if (!listings.includes(listingId)) listings.push(listingId);
      await this.ctx.storage.put("autobidRefs", listings.slice(-100));

      return json({ ok: true, listings });
    }

    if (url.pathname === "/autobids/remove" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const listingId = String(body.listingId || "").trim();
      const refs = await this.ctx.storage.get("autobidRefs");
      const listings = (Array.isArray(refs) ? refs : [])
        .filter(x => x !== listingId);

      await this.ctx.storage.put("autobidRefs", listings);

      const currentCache = await this.ctx.storage.get("autobidCache");
      if (currentCache && typeof currentCache === "object") {
        delete currentCache[listingId];
        await this.ctx.storage.put("autobidCache", currentCache);
      }

      return json({ ok: true, listings });
    }

    return json({ ok: false, error: "Account route not found." }, 404);
  }
}
