const SUPABASE_URL = "https://cyrxjeppjqsxxjayfrur.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg";
const SUPABASE_PROJECT = "cyrxjeppjqsxxjayfrur";

function decodeBase64Url(segment) {
  try {
    let s = String(segment || "").replace(/-/g, "+").replace(/_/g, "/");
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
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

function looksJwt(value) {
  return typeof value === "string" &&
    /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim());
}

function findAuthJwt(value, depth = 0) {
  if (depth > 7 || value == null) return null;

  if (typeof value === "string") {
    const s = value.trim();

    if (looksJwt(s)) {
      const payload = jwtPayload(s);
      if (
        payload?.sub &&
        (payload?.role === "authenticated" || payload?.aud === "authenticated")
      ) return s;
    }

    try {
      const decoded = decodeURIComponent(s);
      if (decoded !== s) {
        const token = findAuthJwt(decoded, depth + 1);
        if (token) return token;
      }
    } catch {}

    if (s.startsWith("base64-")) {
      try {
        let b = s.slice(7).replace(/-/g, "+").replace(/_/g, "/");
        while (b.length % 4) b += "=";
        const token = findAuthJwt(atob(b), depth + 1);
        if (token) return token;
      } catch {}
    }

    if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))
    ) {
      try {
        const token = findAuthJwt(JSON.parse(s), depth + 1);
        if (token) return token;
      } catch {}
    }

    const matches = s.match(
      /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
    );
    if (matches) {
      for (const token of matches) {
        const payload = jwtPayload(token);
        if (
          payload?.sub &&
          (payload?.role === "authenticated" || payload?.aud === "authenticated")
        ) return token;
      }
    }

    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findAuthJwt(item, depth + 1);
      if (token) return token;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const key of ["access_token", "accessToken", "token"]) {
      if (value[key]) {
        const token = findAuthJwt(value[key], depth + 1);
        if (token) return token;
      }
    }

    for (const item of Object.values(value)) {
      const token = findAuthJwt(item, depth + 1);
      if (token) return token;
    }
  }

  return null;
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
        : { name: part.slice(0, i), value: part.slice(i + 1) };
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

function credentialsHeaders(credentials, referer = "https://www.wiki-masters.com/") {
  const headers = new Headers({
    accept: "application/json, text/plain, */*",
    origin: "https://www.wiki-masters.com",
    referer
  });

  if (credentials?.cookie) headers.set("cookie", credentials.cookie);
  if (credentials?.authorization) {
    headers.set("authorization", credentials.authorization);
  }

  return headers;
}

async function readJson(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  return { text, data };
}

async function wikiGet(credentials, url) {
  const response = await fetch(url, {
    method: "GET",
    headers: credentialsHeaders(credentials),
    redirect: "manual"
  });

  const { text, data } = await readJson(response);

  if (!response.ok) {
    throw new Error(
      "WikiMasters GET failed (HTTP " +
        response.status +
        ")" +
        (text ? ": " + text.slice(0, 160) : "")
    );
  }

  return data;
}

export async function resolveAccountCredentials(env, accountId) {
  const stub = env.USER_ACCOUNT.get(
    env.USER_ACCOUNT.idFromName(String(accountId))
  );

  const response = await stub.fetch("https://account.internal/credentials");
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.credentials) {
    throw new Error(data?.error || "Session WikiMasters non connectée.");
  }

  return data.credentials;
}

function deepStringCandidates(root) {
  const out = [];
  const seen = new Set();

  function walk(value, path = [], depth = 0) {
    if (depth > 6 || value == null) return;

    if (typeof value === "string") {
      const s = value.trim();
      if (s) out.push({ value: s, path });
      return;
    }

    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 8); i++) {
        walk(value[i], [...path, String(i)], depth + 1);
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      walk(child, [...path, key], depth + 1);
    }
  }

  walk(root);
  return out;
}

function bestString(raw, kind) {
  const rows = deepStringCandidates(raw)
    .map(candidate => {
      const value = candidate.value;
      const path = candidate.path.map(x => String(x).toLowerCase());
      const leaf = path.at(-1) || "";
      const full = path.join(".");
      let score = 0;

      if (!value || value.length > 500) return { ...candidate, score: -1e9 };
      if (/^https?:\/\//i.test(value)) return { ...candidate, score: -1e9 };
      if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)) {
        return { ...candidate, score: -1e9 };
      }

      if (kind === "title") {
        if (leaf === "title") score += 120;
        if (leaf === "name") score += 75;
        if (/article.*title|wiki.*title|card.*title/.test(leaf)) score += 140;
        if (/article|wikipedia|wiki|card|page|content/.test(full)) score += 35;
        if (/image|photo|author|user|owner|rarity|category|market|price|id|uuid/.test(full)) {
          score -= 70;
        }
        if (value.length >= 3 && value.length <= 100) score += 20;
      } else {
        if (/description|summary|excerpt|subtitle|extract/.test(leaf)) score += 120;
        if (/article|wikipedia|wiki|card|page|content/.test(full)) score += 25;
        if (/image|photo|author|user|owner|rarity|category|market|price|id|uuid/.test(full)) {
          score -= 70;
        }
      }

      return { ...candidate, score };
    })
    .sort((a, b) => b.score - a.score);

  return rows[0]?.score > 0 ? rows[0].value : "";
}

function directString(raw, keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function findImage(raw) {
  const direct = directString(raw, [
    "image_url",
    "imageUrl",
    "image",
    "thumbnail",
    "thumbnail_url",
    "picture",
    "photo"
  ]);
  if (direct && /^https?:\/\//i.test(direct)) return direct;

  const candidates = deepStringCandidates(raw);
  const hit = candidates.find(x =>
    /^https?:\/\//i.test(x.value) &&
    /image|photo|thumbnail|picture|avatar/.test(
      x.path.map(v => String(v).toLowerCase()).join(".")
    )
  );
  return hit?.value || "";
}

function normalizeCard(raw) {
  const apiId = String(
    raw?.id ??
    raw?.card_id ??
    raw?.cardId ??
    raw?.uuid ??
    raw?.key ??
    ""
  );

  const title =
    directString(raw, [
      "wikipedia_title",
      "title",
      "name",
      "articleTitle",
      "article_title",
      "wikiTitle",
      "wiki_title",
      "cardTitle",
      "card_title",
      "label"
    ]) ||
    bestString(raw, "title") ||
    "Carte";

  const subtitle =
    directString(raw, [
      "subtitle",
      "description",
      "excerpt",
      "summary",
      "articleDescription",
      "article_description",
      "wikiDescription",
      "wiki_description"
    ]) ||
    bestString(raw, "subtitle");

  return {
    id: apiId,
    title,
    subtitle: subtitle === title ? "" : subtitle,
    rarity: String(
      raw?.rarity ??
      raw?.rarity_code ??
      raw?.rarityCode ??
      raw?.tier ??
      ""
    ),
    image: findImage(raw),
    wikiUrl: directString(raw, [
      "wikipedia_url",
      "wikipediaUrl",
      "article_url",
      "articleUrl"
    ])
  };
}

function candidateArrayScore(arr) {
  if (!Array.isArray(arr)) return -1;
  let score = Math.min(arr.length, 100);
  for (const item of arr.slice(0, 8)) {
    if (item && typeof item === "object") {
      if (item.id || item.card_id || item.cardId || item.uuid) score += 5;
      if (item.wikipedia_title || item.title || item.name) score += 5;
      if (item.rarity || item.rarity_code) score += 2;
    }
  }
  return score;
}

function findBestArray(root) {
  let best = null;
  let bestScore = -1;
  const seen = new Set();

  function walk(value, depth = 0) {
    if (depth > 5 || value == null || typeof value !== "object" || seen.has(value)) {
      return;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      const score = candidateArrayScore(value);
      if (score > bestScore) {
        bestScore = score;
        best = value;
      }
      for (const child of value.slice(0, 3)) walk(child, depth + 1);
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (
        ["cards", "items", "results", "data", "rows", "content"].includes(key) &&
        Array.isArray(child)
      ) {
        const score = candidateArrayScore(child) + 10;
        if (score > bestScore) {
          bestScore = score;
          best = child;
        }
      }
      walk(child, depth + 1);
    }
  }

  walk(root);
  return best || [];
}

export async function searchCards(credentials, {
  q = "",
  page = 0,
  rarities = []
} = {}) {
  const url = new URL("https://www.wiki-masters.com/api/cards");
  url.searchParams.set("page", String(Math.max(0, Number(page) || 0)));
  url.searchParams.set("q", String(q || "").trim());

  for (const rarity of rarities) {
    const r = String(rarity || "").trim().toUpperCase();
    if (["L", "UR", "SR", "R", "PC", "C"].includes(r)) {
      url.searchParams.append("rarity", r);
    }
  }

  url.searchParams.set("sort", "rarity");
  const data = await wikiGet(credentials, url.toString());

  const cards = findBestArray(data)
    .map(normalizeCard)
    .filter(card => card.id || card.title !== "Carte");

  return {
    ok: true,
    query: String(q || "").trim(),
    page: Math.max(0, Number(page) || 0),
    cards
  };
}

function normalizeOwnedCard(row) {
  const card = row?.card || {};
  return {
    userCardId: String(row?.id || ""),
    cardId: String(row?.card_id || card?.id || ""),
    title: String(
      card?.wikipedia_title ||
      row?.wikipedia_title ||
      card?.title ||
      "Carte"
    ),
    rarity: String(card?.rarity || row?.rarity || ""),
    image: String(card?.image_url || row?.image_url || ""),
    starred: !!row?.starred,
    rawStatus: row?.status || null
  };
}

export async function collectionPage(credentials, {
  page = 0,
  rarity = ""
} = {}) {
  const url = new URL("https://www.wiki-masters.com/api/my-collection");
  url.searchParams.set("sort", "rarity");
  if (rarity) url.searchParams.set("rarity", String(rarity).toUpperCase());
  url.searchParams.set("page", String(Math.max(0, Number(page) || 0)));
  url.searchParams.set("stats", "0");

  const data = await wikiGet(credentials, url.toString());
  const rows = Array.isArray(data?.collection) ? data.collection : [];

  return {
    ok: true,
    page: Math.max(0, Number(page) || 0),
    cards: rows.map(normalizeOwnedCard),
    count: rows.length,
    pendingTradeCardIds: Array.isArray(data?.pendingTradeCardIds)
      ? data.pendingTradeCardIds.map(String)
      : []
  };
}

function normalizeAuction(a) {
  return {
    listingId: String(a?.id || ""),
    cardId: String(a?.card_id || a?.card?.id || ""),
    sellerId: String(a?.seller_id || ""),
    currentBid: Number(a?.current_bid ?? a?.base_amount ?? 0),
    baseAmount: Number(a?.base_amount ?? 0),
    effectiveBid: Number(a?.effective_bid ?? a?.current_bid ?? a?.base_amount ?? 0),
    endAt: a?.end_at || null,
    status: a?.status || null,
    currentBidderId: a?.current_bidder_id || null,
    title:
      a?.card?.wikipedia_title ||
      a?.snapshot_search_document ||
      a?.card?.category ||
      "Carte",
    rarity: a?.snapshot_rarity || a?.card?.rarity || "",
    category: a?.card?.category || "",
    image: a?.card?.image_url || "",
    sellerName: a?.seller?.username || "",
    owned: !!a?.owned
  };
}

export async function marketplacePage(credentials, {
  page = 1,
  limit = 50,
  sort = "recent"
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(5, Math.min(50, Number(limit) || 50));
  const url = new URL("https://www.wiki-masters.com/api/marketplace");
  url.searchParams.set("page", String(safePage));
  url.searchParams.set("limit", String(safeLimit));
  url.searchParams.set("sort", String(sort || "recent"));

  const data = await wikiGet(credentials, url.toString());
  const rows = Array.isArray(data?.auctions) ? data.auctions : [];

  return {
    ok: true,
    page: Number(data?.page || safePage),
    limit: Number(data?.limit || safeLimit),
    hasMore: !!data?.hasMore,
    auctions: rows.map(normalizeAuction)
  };
}

function supabaseSession(credentials) {
  const cookieValue = authCookieValue(credentials?.cookie || "");
  const token =
    findAuthJwt(cookieValue) ||
    findAuthJwt(credentials?.authorization || "");

  const payload = jwtPayload(token);

  if (!token || !payload?.sub) {
    throw new Error(
      "Jeton Supabase introuvable dans la session WikiMasters. Reconnecte le compte WikiMasters."
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp <= now + 10) {
    throw new Error(
      "Le jeton Wishlist a expiré. Reconnecte la session WikiMasters pour le renouveler."
    );
  }

  return {
    token,
    userId: String(payload.sub)
  };
}

async function supabaseRequest(path, session, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    method: options.method || "GET",
    headers: {
      accept: "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: "Bearer " + session.token,
      "accept-profile": "public",
      "content-profile": "public",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.prefer ? { prefer: options.prefer } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const { text, data } = await readJson(response);
  return { ok: response.ok, status: response.status, text, data };
}

export async function getWishlist(credentials) {
  const session = supabaseSession(credentials);
  const ids = [];
  const limit = 1000;

  for (let offset = 0; offset < 10000; offset += limit) {
    const url = new URL(SUPABASE_URL + "/rest/v1/wishlist_items");
    url.searchParams.set("select", "card_id");
    url.searchParams.set("user_id", "eq." + session.userId);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const result = await supabaseRequest(url.pathname + url.search, session);
    if (!result.ok) {
      throw new Error("Lecture wishlist impossible (HTTP " + result.status + ").");
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    for (const row of rows) {
      if (row?.card_id) ids.push(String(row.card_id));
    }

    if (rows.length < limit) break;
  }

  const cardIds = [...new Set(ids)];
  const cards = [];

  for (let i = 0; i < cardIds.length; i += 80) {
    const chunk = cardIds.slice(i, i + 80);
    const url = new URL(SUPABASE_URL + "/rest/v1/cards");
    url.searchParams.set(
      "select",
      "id,wikipedia_title,rarity"
    );
    url.searchParams.set("id", "in.(" + chunk.join(",") + ")");

    const result = await supabaseRequest(url.pathname + url.search, session);
    if (!result.ok) {
      throw new Error("Lecture cartes wishlist impossible (HTTP " + result.status + ").");
    }

    for (const row of Array.isArray(result.data) ? result.data : []) {
      if (!row?.id) continue;
      cards.push({
        id: String(row.id),
        title: String(row.wikipedia_title || "Carte"),
        rarity: String(row.rarity || ""),
        image: ""
      });
    }
  }

  return {
    ok: true,
    userId: session.userId,
    count: cardIds.length,
    cardIds,
    cards
  };
}

export async function addWishlistCard(credentials, cardId) {
  const id = String(cardId || "").trim();
  if (!id) throw new Error("cardId requis.");

  const session = supabaseSession(credentials);

  const existingUrl = new URL(SUPABASE_URL + "/rest/v1/wishlist_items");
  existingUrl.searchParams.set("select", "card_id");
  existingUrl.searchParams.set("user_id", "eq." + session.userId);
  existingUrl.searchParams.set("card_id", "eq." + id);
  existingUrl.searchParams.set("limit", "1");

  const existing = await supabaseRequest(
    existingUrl.pathname + existingUrl.search,
    session
  );

  if (!existing.ok) {
    throw new Error("Vérification wishlist impossible (HTTP " + existing.status + ").");
  }

  if (Array.isArray(existing.data) && existing.data.length) {
    return { ok: true, added: false, already: true, cardId: id };
  }

  const result = await supabaseRequest("/rest/v1/wishlist_items", session, {
    method: "POST",
    body: {
      user_id: session.userId,
      card_id: id
    },
    prefer: "return=minimal"
  });

  if (!result.ok) {
    throw new Error("Ajout wishlist impossible (HTTP " + result.status + ").");
  }

  return { ok: true, added: true, already: false, cardId: id };
}
