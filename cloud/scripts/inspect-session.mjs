import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const PROJECT = "cyrxjeppjqsxxjayfrur";

function parseCookies(header) {
  const out = new Map();
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

function decodeBase64Url(value) {
  let s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
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

function findSession(value, depth = 0) {
  if (depth > 8 || value == null) {
    return { access: null, refresh: null };
  }

  if (typeof value === "string") {
    const s = value.trim();

    if (s.startsWith("base64-")) {
      try {
        return findSession(decodeBase64Url(s.slice(7)), depth + 1);
      } catch {}
    }

    try {
      const d = decodeURIComponent(s);
      if (d !== s) {
        const found = findSession(d, depth + 1);
        if (found.access || found.refresh) return found;
      }
    } catch {}

    if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))
    ) {
      try {
        return findSession(JSON.parse(s), depth + 1);
      } catch {}
    }

    if (/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)) {
      return { access: s, refresh: null };
    }

    return { access: null, refresh: null };
  }

  if (Array.isArray(value)) {
    let access = null;
    let refresh = null;
    for (const item of value) {
      const found = findSession(item, depth + 1);
      access ||= found.access;
      refresh ||= found.refresh;
    }
    return { access, refresh };
  }

  if (typeof value === "object") {
    const access =
      typeof value.access_token === "string" ? value.access_token :
      typeof value.accessToken === "string" ? value.accessToken :
      null;

    const refresh =
      typeof value.refresh_token === "string" ? value.refresh_token :
      typeof value.refreshToken === "string" ? value.refreshToken :
      null;

    if (access || refresh) return { access, refresh };

    let nestedAccess = null;
    let nestedRefresh = null;

    for (const item of Object.values(value)) {
      const found = findSession(item, depth + 1);
      nestedAccess ||= found.access;
      nestedRefresh ||= found.refresh;
    }

    return { access: nestedAccess, refresh: nestedRefresh };
  }

  return { access: null, refresh: null };
}

const rl = readline.createInterface({ input, output });
const cookieHeader = await rl.question("Colle la valeur complete du header Cookie puis Entree:\n> ");
rl.close();

const cookies = parseCookies(cookieHeader);
const prefix = `sb-${PROJECT}-auth-token`;

const direct = cookies.get(prefix) || null;
const chunks = [...cookies.entries()]
  .filter(([name]) => name.startsWith(prefix + "."))
  .map(([name, value]) => ({
    index: Number(name.slice((prefix + ".").length)),
    value
  }))
  .filter(x => Number.isInteger(x.index))
  .sort((a, b) => a.index - b.index);

const serialized = chunks.length
  ? chunks.map(x => x.value).join("")
  : direct;

if (!serialized) {
  console.log("\nCookie Supabase WikiMasters introuvable.");
  process.exit(1);
}

const session = findSession(serialized);
const payload = session.access ? jwtPayload(session.access) : null;
const exp = Number(payload?.exp);
const now = Math.floor(Date.now() / 1000);

console.log("\n=== Resultat sur ton PC uniquement ===");
console.log("Cookie auth trouve       :", true);
console.log("Cookie fragmente         :", chunks.length > 0);
console.log("Nombre de fragments      :", chunks.length || 1);
console.log("Access token present     :", !!session.access);
console.log("Refresh token present    :", !!session.refresh);
console.log("Utilisateur JWT present  :", !!payload?.sub);
console.log("Role JWT                 :", payload?.role || null);
console.log("Expiration access token  :", Number.isFinite(exp) ? new Date(exp * 1000).toISOString() : null);
console.log("Secondes restantes       :", Number.isFinite(exp) ? exp - now : null);
console.log("\nAucun token n'a ete affiche ni envoye.");
