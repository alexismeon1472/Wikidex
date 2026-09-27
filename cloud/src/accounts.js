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
        const credentials = await openJson(this.env.VAULT_MASTER_KEY, sealed);
        return json({ ok: true, credentials });
      } catch (error) {
        return json({
          ok: false,
          error: "Unable to decrypt WikiMasters session."
        }, 500);
      }
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
      return json({ ok: true, listings });
    }

    return json({ ok: false, error: "Account route not found." }, 404);
  }
}
