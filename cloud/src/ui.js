export function renderAppHtml() {
  return \`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WikiDex Cloud</title>
  <meta name="theme-color" content="#111827">
  <style>
    :root {
      color-scheme: dark;
      --bg:#0b1020;
      --panel:#121a2d;
      --panel2:#17213a;
      --text:#edf2ff;
      --muted:#9aa8c7;
      --line:#283552;
      --accent:#7c9cff;
      --good:#66d19e;
      --bad:#ff7f87;
      --warn:#f4c96b;
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      background:linear-gradient(180deg,#0b1020,#0f1628 45%,#0b1020);
      color:var(--text);
      min-height:100vh;
    }
    button,input,textarea { font:inherit; }
    button { cursor:pointer; }
    .wrap { max-width:1100px; margin:0 auto; padding:24px; }
    .top {
      display:flex; align-items:center; justify-content:space-between;
      gap:16px; margin-bottom:24px;
    }
    .brand { font-size:24px; font-weight:800; letter-spacing:-.03em; }
    .brand span { color:var(--accent); }
    .muted { color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(12,1fr); gap:16px; }
    .card {
      background:rgba(18,26,45,.94);
      border:1px solid var(--line);
      border-radius:16px;
      padding:18px;
      box-shadow:0 12px 35px rgba(0,0,0,.18);
    }
    .span12 { grid-column:span 12; }
    .span7 { grid-column:span 7; }
    .span5 { grid-column:span 5; }
    h1,h2,h3,p { margin-top:0; }
    h2 { font-size:17px; margin-bottom:12px; }
    label { display:block; font-size:13px; color:var(--muted); margin:12px 0 6px; }
    input,textarea {
      width:100%;
      color:var(--text);
      background:#0d1425;
      border:1px solid var(--line);
      border-radius:10px;
      padding:11px 12px;
      outline:none;
    }
    textarea { min-height:110px; resize:vertical; }
    input:focus,textarea:focus { border-color:var(--accent); }
    .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .btn {
      border:0;
      border-radius:10px;
      padding:10px 14px;
      color:white;
      background:#31446f;
      font-weight:700;
    }
    .btn.primary { background:#5877df; }
    .btn.danger { background:#7c3541; }
    .btn.ghost { background:transparent; border:1px solid var(--line); }
    .btn:disabled { opacity:.45; cursor:not-allowed; }
    .status {
      display:inline-flex; align-items:center; gap:7px;
      padding:6px 9px; border-radius:999px; font-size:12px;
      background:#1b2742; color:var(--muted);
    }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--muted); }
    .good .dot { background:var(--good); }
    .bad .dot { background:var(--bad); }
    .warn .dot { background:var(--warn); }
    .auction {
      display:grid;
      grid-template-columns:minmax(180px,2fr) repeat(4,minmax(90px,1fr)) auto;
      gap:12px;
      align-items:center;
      border-top:1px solid var(--line);
      padding:13px 0;
    }
    .auction:first-child { border-top:0; }
    .auction-title { font-weight:750; }
    .k { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
    .v { margin-top:2px; }
    .msg {
      display:none; margin:12px 0 0; padding:10px 12px;
      border-radius:10px; background:#1d2945; color:var(--muted);
      white-space:pre-wrap;
    }
    .msg.show { display:block; }
    .msg.error { color:#ffd4d6; background:#3c2028; }
    .msg.success { color:#c9f7df; background:#173328; }
    code { color:#bdd0ff; }
    details { margin-top:14px; }
    summary { cursor:pointer; color:var(--muted); }
    .hidden { display:none !important; }
    .check { display:flex; gap:9px; align-items:flex-start; margin-top:12px; }
    .check input { width:auto; margin-top:3px; }
    @media(max-width:820px){
      .span7,.span5 { grid-column:span 12; }
      .auction { grid-template-columns:1fr 1fr; }
      .auction .actions { grid-column:span 2; }
      .wrap { padding:16px; }
    }
  </style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <div class="brand">Wiki<span>Dex</span> Cloud</div>
      <div class="muted">AutoBid 24/7 sans navigateur ouvert</div>
    </div>
    <div class="row">
      <span id="who" class="muted"></span>
      <button id="logout" class="btn ghost hidden">Déconnexion</button>
    </div>
  </div>

  <section id="loginView" class="grid">
    <div class="card span7">
      <h2>Connexion</h2>
      <p class="muted">Entre ta clé personnelle WikiDex Cloud.</p>
      <label for="token">Clé WikiDex</label>
      <input id="token" type="password" autocomplete="off" placeholder="wdx_…">
      <div class="row" style="margin-top:12px">
        <button id="login" class="btn primary">Se connecter</button>
      </div>
      <div id="loginMsg" class="msg"></div>
    </div>

    <div class="card span5">
      <h2>Administration</h2>
      <p class="muted">Créer un compte utilisateur. La clé générée n’est affichée qu’une fois.</p>
      <label for="adminKey">Clé admin</label>
      <input id="adminKey" type="password" autocomplete="off">
      <label for="newUserName">Nom</label>
      <input id="newUserName" placeholder="Ex. Salomé">
      <button id="createUser" class="btn" style="margin-top:12px">Créer le compte</button>
      <div id="adminMsg" class="msg"></div>
    </div>
  </section>

  <section id="appView" class="grid hidden">
    <div class="card span5">
      <h2>Session WikiMasters</h2>
      <div id="sessionBadge" class="status"><span class="dot"></span><span>Chargement…</span></div>
      <p class="muted" style="margin-top:12px">
        La session est chiffrée côté Cloudflare. Le cookie n’est jamais renvoyé par l’API.
      </p>
      <label for="wikiCookie">Header Cookie</label>
      <textarea id="wikiCookie" placeholder="Colle ici la valeur complète du header Cookie"></textarea>
      <label for="wikiAuthorization">Authorization (optionnel)</label>
      <input id="wikiAuthorization" type="password" placeholder="Bearer … si présent">
      <div class="row" style="margin-top:12px">
        <button id="connectWiki" class="btn primary">Connecter WikiMasters</button>
        <button id="disconnectWiki" class="btn danger">Déconnecter</button>
      </div>
      <div id="sessionMsg" class="msg"></div>
    </div>

    <div class="card span7">
      <h2>Nouvel AutoBid</h2>
      <label for="listing">ID ou URL de l’enchère</label>
      <input id="listing" placeholder="244dfa9e-8167-4135-bcdd-f71dc4177295">
      <label for="max">Plafond Wikibidous</label>
      <input id="max" type="number" min="1" step="1" placeholder="200">
      <div class="check">
        <input id="confirmReal" type="checkbox">
        <label for="confirmReal" style="margin:0">
          J’autorise WikiDex à placer de vraies enchères sur cette annonce jusqu’au plafond indiqué.
        </label>
      </div>
      <button id="startBid" class="btn primary" style="margin-top:12px">Démarrer l’AutoBid</button>
      <div id="bidMsg" class="msg"></div>
    </div>

    <div class="card span12">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Mes AutoBids</h2>
        <button id="refreshBids" class="btn ghost">Actualiser</button>
      </div>
      <div id="bids" style="margin-top:10px"></div>
    </div>
  </section>
</div>

<script>
(() => {
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem("wikidexCloudToken") || "";
  let refreshTimer = null;

  function setMsg(id, text, kind="") {
    const el = $(id);
    el.textContent = text || "";
    el.className = "msg" + (text ? " show" : "") + (kind ? " " + kind : "");
  }

  async function api(path, options={}) {
    const headers = new Headers(options.headers || {});
    if (token) headers.set("authorization", "Bearer " + token);
    if (options.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "HTTP " + response.status);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function showLogin() {
    $("loginView").classList.remove("hidden");
    $("appView").classList.add("hidden");
    $("logout").classList.add("hidden");
    $("who").textContent = "";
    if (refreshTimer) clearInterval(refreshTimer);
  }

  function showApp(me) {
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("logout").classList.remove("hidden");
    $("who").textContent = me.account?.name || "Compte WikiDex";
    updateSessionBadge(me.session);
    loadBids();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadBids, 5000);
  }

  function updateSessionBadge(session) {
    const badge = $("sessionBadge");
    badge.className = "status " + (session?.connected ? "good" : "warn");
    badge.querySelector("span:last-child").textContent =
      session?.connected ? "WikiMasters connecté" : "WikiMasters non connecté";
  }

  async function loadMe() {
    if (!token) return showLogin();
    try {
      const me = await api("/api/me");
      showApp(me);
    } catch {
      localStorage.removeItem("wikidexCloudToken");
      token = "";
      showLogin();
    }
  }

  function formatTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString("fr-FR");
  }

  function statusLabel(bid) {
    if (bid.running) return "Actif";
    if (bid.lastAction === "cap-reached") return "Plafond atteint";
    if (bid.lastAction === "finished-won") return "Gagnée";
    if (bid.finishedAt) return "Terminée";
    if (bid.stoppedAt) return "Arrêté";
    return bid.lastAction || "Inactif";
  }

  async function loadBids() {
    const root = $("bids");
    try {
      const data = await api("/api/autobids");
      root.textContent = "";

      if (!data.items?.length) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "Aucun AutoBid configuré.";
        root.appendChild(p);
        return;
      }

      for (const bid of data.items) {
        const row = document.createElement("div");
        row.className = "auction";

        const title = document.createElement("div");
        const titleMain = document.createElement("div");
        titleMain.className = "auction-title";
        titleMain.textContent = bid.title || bid.listingId;
        const titleSub = document.createElement("div");
        titleSub.className = "muted";
        titleSub.style.fontSize = "12px";
        titleSub.textContent = bid.listingId;
        title.append(titleMain, titleSub);

        const current = document.createElement("div");
        current.innerHTML = '<div class="k">Actuelle</div>';
        const cv = document.createElement("div");
        cv.className = "v";
        cv.textContent = bid.currentBid ?? "—";
        current.appendChild(cv);

        const next = document.createElement("div");
        next.innerHTML = '<div class="k">Suivante</div>';
        const nv = document.createElement("div");
        nv.className = "v";
        nv.textContent = bid.nextBid ?? "—";
        next.appendChild(nv);

        const max = document.createElement("div");
        max.innerHTML = '<div class="k">Plafond</div>';
        const mv = document.createElement("div");
        mv.className = "v";
        mv.textContent = bid.max ?? "—";
        max.appendChild(mv);

        const status = document.createElement("div");
        status.innerHTML = '<div class="k">État</div>';
        const sv = document.createElement("div");
        sv.className = "v";
        sv.textContent = statusLabel(bid);
        status.appendChild(sv);

        const actions = document.createElement("div");
        actions.className = "actions";
        const stop = document.createElement("button");
        stop.className = "btn danger";
        stop.textContent = "Arrêter";
        stop.disabled = !bid.running;
        stop.addEventListener("click", async () => {
          stop.disabled = true;
          try {
            await api("/api/autobids/stop?listing=" + encodeURIComponent(bid.listingId), {
              method:"POST"
            });
            await loadBids();
          } catch (e) {
            alert(e.message);
          }
        });
        actions.appendChild(stop);

        row.append(title,current,next,max,status,actions);
        root.appendChild(row);
      }
    } catch (e) {
      root.textContent = "Erreur : " + e.message;
    }
  }

  $("login").addEventListener("click", async () => {
    setMsg("loginMsg","");
    const candidate = $("token").value.trim();
    if (!candidate) return setMsg("loginMsg","Clé requise.","error");
    token = candidate;
    try {
      const me = await api("/api/me");
      localStorage.setItem("wikidexCloudToken", token);
      $("token").value = "";
      showApp(me);
    } catch (e) {
      token = "";
      setMsg("loginMsg", e.message, "error");
    }
  });

  $("logout").addEventListener("click", () => {
    localStorage.removeItem("wikidexCloudToken");
    token = "";
    showLogin();
  });

  $("createUser").addEventListener("click", async () => {
    setMsg("adminMsg","");
    const adminKey = $("adminKey").value.trim();
    const name = $("newUserName").value.trim();
    if (!adminKey || !name) return setMsg("adminMsg","Clé admin et nom requis.","error");

    try {
      const response = await fetch("/api/admin/users", {
        method:"POST",
        headers:{
          "content-type":"application/json",
          "x-wikidex-admin-key":adminKey
        },
        body:JSON.stringify({name})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erreur");
      setMsg(
        "adminMsg",
        "Compte créé pour " + data.account.name + "\\n\\nClé à transmettre UNE SEULE FOIS :\\n" + data.token,
        "success"
      );
      $("newUserName").value = "";
    } catch (e) {
      setMsg("adminMsg", e.message, "error");
    }
  });

  $("connectWiki").addEventListener("click", async () => {
    setMsg("sessionMsg","");
    const cookie = $("wikiCookie").value.trim();
    const authorization = $("wikiAuthorization").value.trim();
    if (!cookie && !authorization) {
      return setMsg("sessionMsg","Cookie ou Authorization requis.","error");
    }

    try {
      const data = await api("/api/session", {
        method:"PUT",
        body:JSON.stringify({cookie,authorization})
      });
      $("wikiCookie").value = "";
      $("wikiAuthorization").value = "";
      updateSessionBadge(data);
      setMsg("sessionMsg","Session WikiMasters validée et chiffrée.","success");
    } catch (e) {
      setMsg("sessionMsg",e.message,"error");
    }
  });

  $("disconnectWiki").addEventListener("click", async () => {
    if (!confirm("Déconnecter la session WikiMasters de WikiDex Cloud ?")) return;
    try {
      const data = await api("/api/session", {method:"DELETE"});
      updateSessionBadge(data);
      setMsg("sessionMsg","Session supprimée du coffre.","success");
    } catch (e) {
      setMsg("sessionMsg",e.message,"error");
    }
  });

  $("startBid").addEventListener("click", async () => {
    setMsg("bidMsg","");
    const listing = $("listing").value.trim();
    const max = Number($("max").value);
    if (!listing || !Number.isFinite(max) || max <= 0) {
      return setMsg("bidMsg","Enchère et plafond valides requis.","error");
    }
    if (!$("confirmReal").checked) {
      return setMsg("bidMsg","Confirme explicitement l’autorisation de vraies enchères.","error");
    }

    try {
      const data = await api("/api/autobids/start", {
        method:"POST",
        body:JSON.stringify({
          listing,
          max,
          confirm:"REAL_BIDS"
        })
      });

      $("listing").value = "";
      $("max").value = "";
      $("confirmReal").checked = false;
      setMsg("bidMsg","AutoBid armé : " + (data.title || data.listingId),"success");
      await loadBids();
    } catch (e) {
      setMsg("bidMsg",e.message,"error");
    }
  });

  $("refreshBids").addEventListener("click", loadBids);

  loadMe();
})();
</script>
</body>
</html>\`;
}
