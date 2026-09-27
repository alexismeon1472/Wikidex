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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function wikiGet(credentials, url) {
  const target = new URL(url);
  const retryDelays = [0, 450, 1200];
  let lastStatus = 0;
  let lastContentType = "";
  let lastNetworkError = "";

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt]) {
      await sleep(retryDelays[attempt]);
    }

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: credentialsHeaders(credentials),
        redirect: "manual"
      });
    } catch (error) {
      lastNetworkError = error?.message || String(error);
      continue;
    }

    lastStatus = response.status;
    lastContentType = response.headers.get("content-type") || "";
    const { data } = await readJson(response);

    if (response.ok) return data;

    if (![429, 500, 502, 503, 504].includes(response.status)) {
      break;
    }
  }

  if (!lastStatus) {
    throw new Error(
      "WikiMasters GET " + target.pathname +
      " impossible (erreur réseau" +
      (lastNetworkError ? ": " + lastNetworkError : "") +
      ")."
    );
  }

  const kind = /html/i.test(lastContentType)
    ? ", réponse HTML"
    : "";

  throw new Error(
    "WikiMasters GET " + target.pathname +
    " impossible (HTTP " + lastStatus + kind + ")."
  );
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
  const stored = credentials?.supabaseSession || {};
  const cookieValue = authCookieValue(credentials?.cookie || "");

  const token =
    stored.accessToken ||
    stored.access_token ||
    findAuthJwt(cookieValue) ||
    findAuthJwt(credentials?.authorization || "");

  const payload = jwtPayload(token);
  const userId =
    stored.userId ||
    stored.user_id ||
    payload?.sub ||
    null;

  if (!token || !userId) {
    throw new Error(
      "Session Supabase introuvable. Reconnecte une fois WikiMasters pour enregistrer le refresh token."
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const exp =
    Number(stored.expiresAt || stored.expires_at) ||
    Number(payload?.exp) ||
    null;

  if (Number.isFinite(exp) && exp <= now + 10) {
    throw new Error(
      "Le renouvellement automatique du jeton Wishlist a échoué. Reconnecte une fois la session WikiMasters."
    );
  }

  return {
    token,
    userId: String(userId)
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


function normalizeId(value) {
  return String(value || "").trim().toLowerCase().replace(/^api_/, "");
}

function listingPrice(auction) {
  const values = [
    auction?.effectiveBid,
    auction?.currentBid,
    auction?.baseAmount
  ]
    .map(Number)
    .filter(Number.isFinite);

  return values.length ? values[0] : Infinity;
}

function listingEndMs(auction) {
  const end = auction?.endAt ? Date.parse(auction.endAt) : NaN;
  return Number.isFinite(end) ? end : Infinity;
}

export async function getAllOwnedCards(credentials, {
  rarity = ""
} = {}) {
  const items = [];
  const pendingTradeIds = new Set();
  const seenUserCards = new Set();
  let pagesRead = 0;

  for (let page = 0; page < 100; page++) {
    const data = await collectionPage(credentials, { page, rarity });

    for (const id of data.pendingTradeCardIds || []) {
      if (id) pendingTradeIds.add(String(id));
    }

    if (!data.cards.length) {
      pagesRead = page + 1;
      break;
    }

    let added = 0;
    for (const card of data.cards) {
      const userCardId = String(card.userCardId || "");
      if (!userCardId || seenUserCards.has(userCardId)) continue;

      seenUserCards.add(userCardId);
      items.push(card);
      added++;
    }

    pagesRead = page + 1;

    // Same guard as the extension: if the endpoint repeats a page,
    // stop instead of looping forever.
    if (!added) break;

    // Avoid hammering WikiMasters when a collection spans many pages.
    await sleep(90);
  }

  return {
    ok: true,
    items,
    pagesRead,
    pendingTradeCardIds: [...pendingTradeIds]
  };
}

export async function buildPriorityMarketSnapshot(credentials) {
  const wishlist = await getWishlist(credentials);

  return {
    scanId: crypto.randomUUID(),
    createdAt: Date.now(),
    userId: wishlist.userId,
    wishlistCount: wishlist.count,
    wishlistCardIds: wishlist.cardIds
      .map(normalizeId)
      .filter(Boolean)
  };
}

async function requestMarketplacePage(credentials, page, limit) {
  const url = new URL("https://www.wiki-masters.com/api/marketplace");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "recent");

  const retryDelays = [0, 500, 1400];
  let last = null;

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt]) await sleep(retryDelays[attempt]);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: credentialsHeaders(credentials),
        redirect: "manual"
      });

      const contentType = response.headers.get("content-type") || "";
      const { data } = await readJson(response);

      last = {
        ok: response.ok,
        status: response.status,
        contentType,
        data
      };

      if (response.ok) return last;
      if (![429, 500, 502, 503, 504].includes(response.status)) return last;
    } catch (error) {
      last = {
        ok: false,
        status: 0,
        contentType: "",
        data: null,
        error: error?.message || String(error)
      };
    }
  }

  return last || {
    ok: false,
    status: 0,
    contentType: "",
    data: null
  };
}

async function fetchMarketplaceSegment(credentials, offset, size) {
  if (offset % size !== 0) {
    return {
      ok: false,
      rows: [],
      hasMore: true,
      failedSegments: 1,
      recovered: false
    };
  }

  const page = offset / size + 1;
  const result = await requestMarketplacePage(credentials, page, size);

  if (result?.ok) {
    const rows = Array.isArray(result.data?.auctions)
      ? result.data.auctions
      : [];

    return {
      ok: true,
      rows,
      hasMore: !!result.data?.hasMore,
      failedSegments: 0,
      recovered: false
    };
  }

  let childSize = null;
  if (size === 50) childSize = 25;
  else if (size === 25) childSize = 5;

  if (childSize) {
    const rows = [];
    let hasMore = true;
    let failedSegments = 0;

    for (
      let childOffset = offset;
      childOffset < offset + size;
      childOffset += childSize
    ) {
      const part = await fetchMarketplaceSegment(
        credentials,
        childOffset,
        childSize
      );

      rows.push(...(part.rows || []));
      hasMore = part.hasMore;
      failedSegments += Number(part.failedSegments) || 0;
    }

    return {
      ok: true,
      rows,
      hasMore,
      failedSegments,
      recovered: true
    };
  }

  return {
    ok: true,
    rows: [],
    hasMore: true,
    failedSegments: 1,
    recovered: false
  };
}

export async function scanPriorityMarketChunk(credentials, {
  wishlistCardIds = [],
  userId = null,
  offset = 0
} = {}) {
  const wished = new Set(
    (Array.isArray(wishlistCardIds) ? wishlistCardIds : [])
      .map(normalizeId)
      .filter(Boolean)
  );

  const segment = await fetchMarketplaceSegment(
    credentials,
    Math.max(0, Number(offset) || 0),
    50
  );

  const now = Date.now();
  const matches = [];
  let ownedExcluded = 0;
  let wishlistListings = 0;

  for (const raw of segment.rows || []) {
    const auction = normalizeAuction(raw);
    const cardId = normalizeId(auction.cardId);

    if (!cardId || !wished.has(cardId)) continue;
    wishlistListings++;

    if (auction.owned) {
      ownedExcluded++;
      continue;
    }

    if (String(auction.status || "").toLowerCase() !== "active") continue;
    if (userId && String(auction.sellerId) === String(userId)) continue;

    const end = listingEndMs(auction);
    if (Number.isFinite(end) && end <= now) continue;

    matches.push(auction);
  }

  return {
    ok: true,
    scannedListings: (segment.rows || []).length,
    failedSegments: Number(segment.failedSegments) || 0,
    recovered: !!segment.recovered,
    wishlistListings,
    ownedExcluded,
    matches,
    hasMore: segment.hasMore !== false,
    nextOffset:
      segment.hasMore === false
        ? null
        : Math.max(0, Number(offset) || 0) + 50
  };
}

export async function analyzeCommonCleanup(credentials, {
  protectStarred = true
} = {}) {
  const [wishlist, collection] = await Promise.all([
    getWishlist(credentials),
    getAllOwnedCards(credentials, { rarity: "C" })
  ]);

  const wishlistIds = new Set(
    wishlist.cardIds.map(normalizeId).filter(Boolean)
  );
  const pendingRaw = new Set(
    collection.pendingTradeCardIds.map(String)
  );
  const pendingNormalized = new Set(
    collection.pendingTradeCardIds.map(normalizeId).filter(Boolean)
  );

  // Defense in depth: do not trust the server-side rarity filter alone.
  // Only explicit rarity C cards can ever enter a discard plan.
  const commons = collection.items.filter(
    row => String(row?.rarity || "").trim().toUpperCase() === "C"
  );

  const candidates = [];
  let protectedWishlist = 0;
  let protectedPending = 0;
  let protectedStarred = 0;

  for (const row of commons) {
    const cardId = normalizeId(row.cardId);
    const userCardId = String(row.userCardId || "");

    if (cardId && wishlistIds.has(cardId)) {
      protectedWishlist++;
      continue;
    }

    if (
      pendingRaw.has(userCardId) ||
      (cardId && pendingNormalized.has(cardId))
    ) {
      protectedPending++;
      continue;
    }

    if (protectStarred && row.starred) {
      protectedStarred++;
      continue;
    }

    if (userCardId) {
      candidates.push({
        userCardId,
        cardId,
        title: row.title,
        rarity: row.rarity,
        starred: !!row.starred
      });
    }
  }

  return {
    ok: true,
    protectStarred: !!protectStarred,
    scanned: commons.length,
    pagesRead: collection.pagesRead,
    wishlistCount: wishlist.count,
    protectedWishlist,
    protectedPending,
    protectedStarred,
    candidates
  };
}

export async function discardUserCardOnce(credentials, userCardId) {
  const id = String(userCardId || "").trim();
  if (!id) {
    return {
      outcome: "rejected",
      httpStatus: 0,
      error: "Invalid user-card id."
    };
  }

  // CRITICAL: exactly one destructive request. Never retry here.
  let response;
  try {
    response = await fetch(
      "https://www.wiki-masters.com/api/user-cards/" +
        encodeURIComponent(id) +
        "/discard",
      {
        method: "POST",
        headers: credentialsHeaders(credentials),
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

  const { text, data } = await readJson(response);

  if (!response.ok) {
    return {
      outcome: "rejected",
      httpStatus: response.status,
      error: String(
        data?.error ||
        data?.message ||
        text ||
        "Discard rejected."
      ).slice(0, 240)
    };
  }

  const balance = Number(data?.balance);

  return {
    outcome: "accepted",
    httpStatus: response.status,
    balance: Number.isFinite(balance) ? balance : null
  };
}


function pricingCandidates(root, source) {
  const out = [];
  const seen = new Set();
  const keyword =
    /(price|prix|avg|average|mean|median|market|sale|sell|sold|value|worth|wikibid)/i;

  function walk(value, path = [], depth = 0) {
    if (depth > 7 || value == null) return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 12); i++) {
        walk(value[i], [...path, String(i)], depth + 1);
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key];
      const full = next.join(".");

      if (keyword.test(key)) {
        const keyLower = String(key || "").toLowerCase();
        const pathLower = full.toLowerCase();
        const numeric =
          typeof child === "number"
            ? child
            : (
                typeof child === "string" &&
                /^-?\d+(?:[.,]\d+)?$/.test(child.trim())
              )
              ? Number(child.replace(",", "."))
              : NaN;

        const looksIdentifier =
          /(^|[_\.])(id|uuid)$/i.test(pathLower) ||
          /seller_?id|buyer_?id|user_?id|card_?id|listing_?id/i.test(pathLower);

        if (
          !looksIdentifier &&
          Number.isFinite(numeric) &&
          numeric >= 0
        ) {
          out.push({
            source,
            path: full,
            value: numeric
          });
        }
      }

      if (child && typeof child === "object") {
        walk(child, next, depth + 1);
      }
    }
  }

  walk(root);

  return out
    .filter((item, index, arr) =>
      arr.findIndex(x =>
        x.source === item.source &&
        x.path === item.path &&
        String(x.value) === String(item.value)
      ) === index
    )
    .slice(0, 80);
}

function probableAverage(candidates) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map(item => {
      const p = String(item.path || "").toLowerCase();
      const n = Number(item.value);
      if (!Number.isFinite(n) || n < 0) return null;

      let score = 0;
      if (/average|avg|mean|moyenne/.test(p)) score += 100;
      if (/median|mediane/.test(p)) score += 70;
      if (/sold|sale|sell|vente/.test(p)) score += 35;
      if (/price|prix|value|worth|market/.test(p)) score += 20;
      if (/current|base|minimum|min_|max_|starting|start/.test(p)) score -= 35;
      if (/count|quantity|total_sales|number/.test(p)) score -= 40;

      return { ...item, number: n, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score >= 70
    ? {
        source: ranked[0].source,
        path: ranked[0].path,
        value: ranked[0].number
      }
    : null;
}

export async function probeCardPricing(credentials, {
  cardId = "",
  listingId = ""
} = {}) {
  let resolvedCardId = String(cardId || "").trim();
  let title = "";
  let rarity = "";
  let imageUrl = "";
  let sellerName = "";
  let currentBid = null;
  let endAt = null;
  let salesSummary = null;
  const candidates = [];
  const inspectedSources = [];

  if (listingId) {
    const data = await wikiGet(
      credentials,
      "https://www.wiki-masters.com/api/marketplace/" +
        encodeURIComponent(String(listingId))
    );

    const auction = data?.auction || data || null;
    if (auction && typeof auction === "object") {
      resolvedCardId = String(
        resolvedCardId ||
        auction?.card_id ||
        auction?.card?.id ||
        ""
      );

      title = String(
        auction?.card?.wikipedia_title ||
        auction?.snapshot_search_document ||
        ""
      );

      rarity = String(
        auction?.snapshot_rarity ||
        auction?.card?.rarity ||
        ""
      ).trim().toUpperCase();

      imageUrl = String(
        auction?.card?.image_url ||
        auction?.card?.imageUrl ||
        ""
      ).trim();

      sellerName = String(
        auction?.seller?.username ||
        auction?.seller?.name ||
        ""
      ).trim();

      const bidValue = Number(
        auction?.current_bid ??
        auction?.base_amount
      );
      currentBid = Number.isFinite(bidValue) ? bidValue : null;
      endAt = auction?.end_at || null;

      inspectedSources.push("marketplace-detail");
    }
  }

  if (!resolvedCardId) {
    throw new Error("Impossible de déterminer l'identifiant de la carte.");
  }

  try {
    const salesUrl = new URL(
      "https://www.wiki-masters.com/api/marketplace/cards/" +
        encodeURIComponent(resolvedCardId) +
        "/sales"
    );
    salesUrl.searchParams.set("scope", "summary");

    salesSummary = await wikiGet(credentials, salesUrl.toString());
    inspectedSources.push("marketplace-card-sales-summary");
  } catch (error) {
    throw new Error(
      "Lecture de la moyenne WikiMasters impossible : " +
      (error?.message || String(error))
    );
  }

  if (!title) {
    title = String(salesSummary?.wikipedia_title || "");
  }

  const summary =
    salesSummary?.summary && typeof salesSummary.summary === "object"
      ? salesSummary.summary
      : {};

  const averages = Object.entries(summary)
    .map(([key, value]) => {
      const average = Number(value?.average);
      return Number.isFinite(average)
        ? {
            rarity: String(key || "").toUpperCase(),
            average
          }
        : null;
    })
    .filter(Boolean);

  let selected = null;

  if (rarity) {
    selected = averages.find(item => item.rarity === rarity) || null;
  }

  if (!selected && averages.length === 1) {
    selected = averages[0];
  }

  if (!selected && averages.length) {
    selected = averages[0];
  }

  return {
    ok: true,
    cardId: resolvedCardId,
    listingId: listingId || null,
    title: title || null,
    rarity: rarity || selected?.rarity || null,
    imageUrl: imageUrl || null,
    sellerName: sellerName || null,
    currentBid,
    endAt,
    average: selected?.average ?? null,
    averages,
    source: "marketplace-card-sales-summary",
    isPro: salesSummary?.isPro === true,
    inspectedSources,
    rawShape: {
      hasSummary: !!salesSummary?.summary,
      rarities: Object.keys(summary)
    }
  };
}


function detectBidParticipation(raw, userId) {
  const uid = String(userId || "");
  const currentBidder = String(
    raw?.current_bidder_id ||
    raw?.currentBidderId ||
    ""
  );

  if (uid && currentBidder === uid) {
    return { participated: true, method: "current-bidder" };
  }

  const directBooleans = [
    "has_bid",
    "hasBid",
    "user_has_bid",
    "userHasBid",
    "has_user_bid",
    "is_bidder",
    "isBidder",
    "participating",
    "user_participating",
    "userParticipating"
  ];

  for (const key of directBooleans) {
    if (raw?.[key] === true) {
      return { participated: true, method: key };
    }
  }

  const directBidValues = [
    "my_bid",
    "myBid",
    "user_bid",
    "userBid",
    "my_bid_amount",
    "myBidAmount",
    "user_bid_amount",
    "userBidAmount",
    "last_user_bid",
    "lastUserBid"
  ];

  for (const key of directBidValues) {
    const value = raw?.[key];

    if (value && typeof value === "object") {
      return { participated: true, method: key };
    }

    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      return { participated: true, method: key };
    }
  }

  const seen = new Set();

  function walk(value, path = [], depth = 0) {
    if (depth > 6 || value == null) return null;

    if (typeof value !== "object") {
      const full = path.join(".").toLowerCase();

      if (
        uid &&
        String(value) === uid &&
        /bid|bidder|ench/i.test(full)
      ) {
        return { participated: true, method: full || "nested-user-id" };
      }

      if (
        /(^|\.)(has_bid|user_has_bid|is_bidder|participating)$/i.test(full) &&
        value === true
      ) {
        return { participated: true, method: full };
      }

      if (
        /my_?bid|user_?bid/i.test(full)
      ) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) {
          return { participated: true, method: full };
        }
      }

      return null;
    }

    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 50); i++) {
        const hit = walk(value[i], [...path, String(i)], depth + 1);
        if (hit) return hit;
      }
      return null;
    }

    for (const [key, child] of Object.entries(value)) {
      const hit = walk(child, [...path, key], depth + 1);
      if (hit) return hit;
    }

    return null;
  }

  return walk(raw) || { participated: false, method: null };
}

export async function discoverMyActiveBids(credentials, {
  startPage = 1,
  maxPages = 8
} = {}) {
  const session = supabaseSession(credentials);
  const userId = session.userId;
  const items = [];
  const seenListings = new Set();
  let pagesRead = 0;
  let scannedListings = 0;
  let failedPages = 0;
  let nextPage = null;
  let finished = false;

  const firstPage = Math.max(1, Number(startPage) || 1);
  const pageBudget = Math.max(
    1,
    Math.min(10, Number(maxPages) || 8)
  );
  const lastPage = firstPage + pageBudget - 1;

  for (let page = firstPage; page <= lastPage; page++) {
    const result = await requestMarketplacePage(credentials, page, 50);
    pagesRead++;

    if (!result?.ok) {
      failedPages++;
      if (failedPages >= 3) {
        nextPage = page + 1;
        break;
      }
      continue;
    }

    const rows = Array.isArray(result.data?.auctions)
      ? result.data.auctions
      : [];

    scannedListings += rows.length;

    for (const raw of rows) {
      const auction = normalizeAuction(raw);
      if (!auction.listingId || seenListings.has(auction.listingId)) continue;
      seenListings.add(auction.listingId);

      if (String(auction.status || "").toLowerCase() !== "active") continue;

      const end = listingEndMs(auction);
      if (Number.isFinite(end) && end <= Date.now()) continue;

      if (auction.sellerId && String(auction.sellerId) === String(userId)) {
        continue;
      }

      const participation = detectBidParticipation(raw, userId);
      if (!participation.participated) continue;

      items.push({
        ...auction,
        syncMethod: participation.method,
        isHighest:
          !!auction.currentBidderId &&
          String(auction.currentBidderId) === String(userId)
      });
    }

    if (result.data?.hasMore === false || rows.length < 50) {
      finished = true;
      nextPage = null;
      break;
    }

    if (page === lastPage) {
      nextPage = page + 1;
    }

    await sleep(70);
  }

  return {
    ok: true,
    userId,
    startPage: firstPage,
    pagesRead,
    scannedListings,
    failedPages,
    nextPage,
    finished,
    items
  };
}
