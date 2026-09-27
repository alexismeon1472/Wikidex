export function renderAppHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#0b1020">
  <title>WikiDex Cloud</title>
  <style>
    :root{
      color-scheme:dark;
      --bg:#090e1a;
      --panel:#111a2e;
      --panel2:#16213b;
      --panel3:#0d1527;
      --text:#edf3ff;
      --muted:#98a7c7;
      --line:#293754;
      --accent:#6f91ff;
      --accent2:#8ca8ff;
      --good:#66d19e;
      --bad:#ff7f87;
      --warn:#f4c96b;
      --shadow:0 18px 50px rgba(0,0,0,.22);
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      min-height:100vh;
      background:
        radial-gradient(circle at top left,rgba(91,121,221,.14),transparent 32rem),
        linear-gradient(180deg,#090e1a,#0d1425 42%,#090e1a);
      color:var(--text);
      font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    button,input,textarea,select{font:inherit}
    button{cursor:pointer}
    .wrap{max-width:1280px;margin:0 auto;padding:20px}
    .top{
      display:flex;align-items:center;justify-content:space-between;
      gap:16px;margin-bottom:16px
    }
    .brand{font-size:25px;font-weight:850;letter-spacing:-.04em}
    .brand span{color:var(--accent)}
    .subbrand{font-size:12px;color:var(--muted);margin-top:2px}
    .muted{color:var(--muted)}
    .hidden{display:none!important}
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
    .span12{grid-column:span 12}
    .span8{grid-column:span 8}
    .span7{grid-column:span 7}
    .span6{grid-column:span 6}
    .span5{grid-column:span 5}
    .span4{grid-column:span 4}
    .card{
      background:rgba(17,26,46,.94);
      border:1px solid var(--line);
      border-radius:16px;
      padding:17px;
      box-shadow:var(--shadow)
    }
    h1,h2,h3,p{margin-top:0}
    h2{font-size:17px;margin-bottom:12px}
    h3{font-size:14px;margin-bottom:8px}
    label{display:block;font-size:12px;color:var(--muted);margin:11px 0 6px}
    input,textarea,select{
      width:100%;
      color:var(--text);
      background:var(--panel3);
      border:1px solid var(--line);
      border-radius:10px;
      padding:10px 11px;
      outline:none
    }
    textarea{min-height:110px;resize:vertical}
    input:focus,textarea:focus,select:focus{border-color:var(--accent)}
    .btn{
      border:0;border-radius:10px;padding:9px 13px;
      color:white;background:#31446f;font-weight:750
    }
    .btn.primary{background:#5877df}
    .btn.danger{background:#7c3541}
    .btn.good{background:#267452}
    .btn.ghost{background:transparent;border:1px solid var(--line)}
    .btn.small{padding:7px 9px;font-size:12px}
    .btn:disabled{opacity:.45;cursor:not-allowed}
    .nav{
      display:flex;gap:7px;overflow-x:auto;padding:4px 0 12px;
      scrollbar-width:thin
    }
    .nav button{
      white-space:nowrap;border:1px solid var(--line);background:var(--panel3);
      color:var(--muted);padding:9px 12px;border-radius:999px;font-weight:700
    }
    .nav button.active{background:#24355d;color:white;border-color:#3d568e}
    .status{
      display:inline-flex;align-items:center;gap:7px;
      padding:6px 9px;border-radius:999px;font-size:12px;
      background:#1b2742;color:var(--muted)
    }
    .dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
    .good .dot{background:var(--good)}
    .bad .dot{background:var(--bad)}
    .warn .dot{background:var(--warn)}
    .msg{
      display:none;margin:12px 0 0;padding:10px 12px;
      border-radius:10px;background:#1d2945;color:var(--muted);
      white-space:pre-wrap
    }
    .msg.show{display:block}
    .msg.error{color:#ffd4d6;background:#3c2028}
    .msg.success{color:#c9f7df;background:#173328}
    .check{display:flex;gap:9px;align-items:flex-start;margin-top:12px}
    .check input{width:auto;margin-top:3px}
    .metric{
      background:var(--panel3);border:1px solid var(--line);border-radius:13px;
      padding:14px
    }
    .metric .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
    .metric .v{font-size:24px;font-weight:850;margin-top:3px}
    .toolbar{
      display:grid;grid-template-columns:minmax(180px,1fr) auto;
      gap:10px;align-items:end
    }
    .rarities{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
    .rarityChoice{
      display:flex;align-items:center;gap:5px;
      padding:6px 8px;border:1px solid var(--line);border-radius:999px;
      font-size:12px;color:var(--muted);background:var(--panel3)
    }
    .rarityChoice input{width:auto;margin:0}
    .cards{
      display:grid;
      grid-template-columns:repeat(auto-fill,minmax(175px,1fr));
      gap:12px
    }
    .wikiCard{
      border:1px solid var(--line);border-radius:13px;overflow:hidden;
      background:var(--panel3);min-width:0;display:flex;flex-direction:column
    }
    .wikiCard img{
      width:100%;height:130px;object-fit:cover;background:#080d17
    }
    .noimg{
      height:130px;display:grid;place-items:center;
      color:var(--muted);background:#080d17;font-size:12px
    }
    .wikiCardBody{padding:11px;display:flex;flex-direction:column;gap:6px;flex:1}
    .wikiTitle{font-weight:800;line-height:1.25}
    .wikiSub{
      font-size:12px;color:var(--muted);line-height:1.35;
      display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden
    }
    .badge{
      display:inline-flex;width:max-content;padding:4px 7px;border-radius:999px;
      border:1px solid var(--line);font-size:11px;color:var(--accent2)
    }
    .wikiActions{display:flex;gap:6px;margin-top:auto;padding-top:4px}
    .tableList{display:flex;flex-direction:column}
    .marketRow,.auctionRow{
      display:grid;gap:11px;align-items:center;
      border-top:1px solid var(--line);padding:12px 0
    }
    .marketRow{grid-template-columns:minmax(190px,2fr) repeat(4,minmax(85px,1fr)) auto}
    .auctionRow{grid-template-columns:minmax(190px,2fr) repeat(4,minmax(85px,1fr)) auto}
    .marketRow:first-child,.auctionRow:first-child{border-top:0}
    .cellK{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
    .cellV{margin-top:2px}
    .sectionHead{
      display:flex;justify-content:space-between;align-items:center;gap:12px;
      margin-bottom:10px
    }
    .pageControls{display:flex;gap:7px;align-items:center}
    .errorBox{
      padding:12px;border-radius:10px;background:#3c2028;color:#ffd4d6
    }
    @media(max-width:900px){
      .span8,.span7,.span6,.span5,.span4{grid-column:span 12}
      .marketRow,.auctionRow{grid-template-columns:1fr 1fr}
      .marketRow .actions,.auctionRow .actions{grid-column:span 2}
    }
    @media(max-width:620px){
      .wrap{padding:13px}
      .top{align-items:flex-start}
      .toolbar{grid-template-columns:1fr}
      .cards{grid-template-columns:repeat(2,minmax(0,1fr))}
      .wikiCard img,.noimg{height:110px}
    }
  </style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">Wiki<span>Dex</span> Cloud</div>
      <div class="subbrand">Catalogue · Collection · Wishlist · Marché · AutoBid 24/7</div>
    </div>
    <div class="row">
      <span id="who" class="muted"></span>
      <button id="logout" class="btn ghost hidden">Déconnexion</button>
    </div>
  </header>

  <section id="loginView" class="grid">
    <div class="card span7">
      <h2>Connexion</h2>
      <p class="muted">Entre ta clé personnelle WikiDex Cloud.</p>
      <label for="token">Clé WikiDex</label>
      <input id="token" type="password" autocomplete="off" placeholder="wdx_…">
      <div class="check">
        <input id="rememberMe" type="checkbox" checked>
        <label for="rememberMe" style="margin:0">Se souvenir de moi sur cet appareil</label>
      </div>
      <button id="login" class="btn primary" style="margin-top:12px">Se connecter</button>
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

  <section id="appView" class="hidden">
    <nav class="nav" id="nav">
      <button data-tab="market" class="active">Marché</button>
      <button data-tab="search">Recherche</button>
      <button data-tab="collection">Collection</button>
      <button data-tab="wishlist">Wishlist</button>
      <button data-tab="autobid">AutoBid</button>
      <button data-tab="cleanup">Nettoyage</button>
      <button data-tab="settings">Réglages</button>
    </nav>

    <div id="tab-search" class="tabPage hidden">
      <div class="card">
        <div class="sectionHead">
          <div><h2 style="margin-bottom:4px">Recherche de cartes</h2><div class="muted">Catalogue WikiMasters.</div></div>
        </div>
        <div class="toolbar">
          <div>
            <label for="searchQ">Recherche</label>
            <input id="searchQ" placeholder="Mont-Saint-Michel, Comté…">
          </div>
          <button id="searchBtn" class="btn primary">Rechercher</button>
        </div>
        <div class="rarities" id="rarityChoices">
          <label class="rarityChoice"><input type="checkbox" value="L" checked>L</label>
          <label class="rarityChoice"><input type="checkbox" value="UR" checked>UR</label>
          <label class="rarityChoice"><input type="checkbox" value="SR" checked>SR</label>
          <label class="rarityChoice"><input type="checkbox" value="R" checked>R</label>
          <label class="rarityChoice"><input type="checkbox" value="PC" checked>PC</label>
          <label class="rarityChoice"><input type="checkbox" value="C" checked>C</label>
        </div>
        <div id="searchMsg" class="msg"></div>
        <div id="searchResults" class="cards" style="margin-top:14px"></div>
      </div>
    </div>

    <div id="tab-collection" class="tabPage hidden">
      <div class="card">
        <div class="sectionHead">
          <div><h2 style="margin-bottom:4px">Ma collection</h2><div class="muted">Cartes possédées sur WikiMasters.</div></div>
          <div class="row">
            <select id="collectionRarity" style="width:auto">
              <option value="">Toutes raretés</option>
              <option value="L">L</option>
              <option value="UR">UR</option>
              <option value="SR">SR</option>
              <option value="R">R</option>
              <option value="PC">PC</option>
              <option value="C">C</option>
            </select>
            <button id="refreshCollection" class="btn ghost">Actualiser</button>
          </div>
        </div>
        <div class="pageControls">
          <button id="collectionPrev" class="btn ghost small">← Précédent</button>
          <span id="collectionPageLabel" class="muted">Page 1</span>
          <button id="collectionNext" class="btn ghost small">Suivant →</button>
        </div>
        <div id="collectionMsg" class="msg"></div>
        <div id="collectionResults" class="cards" style="margin-top:14px"></div>
      </div>
    </div>

    <div id="tab-wishlist" class="tabPage hidden">
      <div class="card">
        <div class="sectionHead">
          <div><h2 style="margin-bottom:4px">Wishlist</h2><div class="muted">Synchronisée avec la wishlist WikiMasters.</div></div>
          <button id="refreshWishlist" class="btn ghost">Actualiser</button>
        </div>
        <label for="wishlistFilter">Filtrer</label>
        <input id="wishlistFilter" placeholder="Titre ou rareté">
        <div id="wishlistMsg" class="msg"></div>
        <div id="wishlistResults" class="cards" style="margin-top:14px"></div>
      </div>
    </div>

    <div id="tab-market" class="tabPage">
      <div class="grid">
        <div class="card span12">
          <div class="sectionHead">
            <div>
              <h2 style="margin-bottom:4px">Priorités wishlist</h2>
              <div class="muted">Wishlist · cartes déjà possédées exclues · meilleure enchère par carte · tri fin la plus proche puis prix le plus bas.</div>
            </div>
            <button id="scanPriorityMarket" class="btn primary">↻ Scanner ma wishlist</button>
          </div>
          <div id="prioritySummary" class="row" style="margin-bottom:10px"></div>
          <div id="priorityMsg" class="msg"></div>
          <div id="priorityResults" class="tableList" style="margin-top:12px"></div>
        </div>

        <div class="card span12">
          <div class="sectionHead">
            <div>
              <h2 style="margin-bottom:4px">Toutes les enchères</h2>
              <div class="muted">Flux récent WikiMasters.</div>
            </div>
            <button id="refreshMarket" class="btn ghost">Actualiser</button>
          </div>
          <div class="toolbar">
            <div>
              <label for="marketFilter">Filtrer la page</label>
              <input id="marketFilter" placeholder="Titre, rareté, vendeur…">
            </div>
            <div class="pageControls">
              <button id="marketPrev" class="btn ghost small">←</button>
              <span id="marketPageLabel" class="muted">Page 1</span>
              <button id="marketNext" class="btn ghost small">→</button>
            </div>
          </div>
          <div id="marketMsg" class="msg"></div>
          <div id="marketResults" class="tableList" style="margin-top:12px"></div>
        </div>
      </div>
    </div>

    <div id="tab-autobid" class="tabPage hidden">
      <div class="grid">
        <div class="card span5">
          <h2>Nouvel AutoBid</h2>
          <label for="listing">ID ou URL de l’enchère</label>
          <input id="listing" placeholder="UUID ou URL WikiMasters">
          <label for="max">Plafond Wikibidous</label>
          <input id="max" type="number" min="1" step="1" placeholder="200">
          <div style="margin-top:10px;padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--panel3)">
            <div class="row" style="justify-content:space-between">
              <div>
                <div class="cellK">Référence de prix</div>
                <div id="pricingValue" class="cellV">Non recherchée</div>
              </div>
              <button id="probePricing" class="btn ghost small">Chercher la moyenne</button>
            </div>
            <div id="pricingMeta" class="muted" style="font-size:11px;margin-top:6px"></div>
            <div id="pricingActions" class="row hidden" style="margin-top:8px">
              <button class="btn small" data-average-multiplier="0.8">80 %</button>
              <button class="btn small" data-average-multiplier="1">100 %</button>
              <button class="btn small" data-average-multiplier="1.2">120 %</button>
            </div>
          </div>
          <div class="check">
            <input id="confirmReal" type="checkbox">
            <label for="confirmReal" style="margin:0">
              J’autorise WikiDex à placer de vraies enchères jusqu’au plafond indiqué.
            </label>
          </div>
          <button id="startBid" class="btn primary" style="margin-top:12px">Démarrer l’AutoBid</button>
          <div id="bidMsg" class="msg"></div>
        </div>

        <div class="card span7">
          <div class="sectionHead">
            <div><h2 style="margin:0">Mes AutoBids</h2></div>
            <button id="refreshBids" class="btn ghost">Actualiser</button>
          </div>
          <div id="bids" class="tableList"></div>
        </div>
      </div>
    </div>

    <div id="tab-cleanup" class="tabPage hidden">
      <div class="grid">
        <div class="card span5">
          <h2>Nettoyage des communes</h2>
          <p class="muted">
            Analyse uniquement les cartes communes (C). Les cartes en wishlist et en transaction sont toujours protégées.
          </p>
          <div class="check">
            <input id="cleanupProtectStarred" type="checkbox" checked>
            <label for="cleanupProtectStarred" style="margin:0">Protéger aussi les cartes étoilées</label>
          </div>
          <button id="cleanupAnalyze" class="btn primary" style="margin-top:12px">Analyser</button>
          <div id="cleanupMsg" class="msg"></div>
        </div>

        <div class="card span7">
          <h2>Résultat de l’analyse</h2>
          <div id="cleanupStats" class="grid">
            <div class="span4 metric"><div class="k">Communes analysées</div><div class="v" id="cleanupScanned">—</div></div>
            <div class="span4 metric"><div class="k">Défaussables</div><div class="v" id="cleanupDiscardable">—</div></div>
            <div class="span4 metric"><div class="k">Protégées</div><div class="v" id="cleanupProtected">—</div></div>
          </div>
          <div id="cleanupDetails" class="muted" style="margin-top:12px"></div>
          <div id="cleanupCandidates" style="margin-top:12px;max-height:280px;overflow:auto"></div>
          <div class="check">
            <input id="cleanupConfirm" type="checkbox">
            <label for="cleanupConfirm" style="margin:0">
              Je confirme vouloir défausser définitivement toutes les cartes listées ci-dessus.
            </label>
          </div>
          <button id="cleanupExecute" class="btn danger" style="margin-top:12px" disabled>Défausser les cartes</button>
          <div id="cleanupRunMsg" class="msg"></div>
        </div>
      </div>
    </div>

    <div id="tab-settings" class="tabPage hidden">
      <div class="grid">
        <div class="card span6">
          <h2>Session WikiMasters</h2>
          <div id="sessionBadge" class="status"><span class="dot"></span><span>Chargement…</span></div>
          <p class="muted" style="margin-top:12px">
            La session est validée puis chiffrée côté Cloudflare. Le cookie n’est jamais renvoyé au navigateur.
          </p>
          <label for="wikiCookie">Header Cookie</label>
          <textarea id="wikiCookie" placeholder="Valeur complète du header Cookie"></textarea>
          <label for="wikiAuthorization">Authorization (optionnel)</label>
          <input id="wikiAuthorization" type="password" placeholder="Bearer … si présent">
          <div class="row" style="margin-top:12px">
            <button id="connectWiki" class="btn primary">Connecter WikiMasters</button>
            <button id="disconnectWiki" class="btn danger">Déconnecter</button>
          </div>
          <div id="sessionMsg" class="msg"></div>
        </div>

        <div class="card span6">
          <h2>Compte WikiDex</h2>
          <p class="muted">
            La case « Se souvenir de moi » conserve la clé WikiDex sur cet appareil.
            Sans elle, la clé reste seulement pour la session du navigateur.
          </p>
          <button id="settingsLogout" class="btn danger">Déconnecter WikiDex</button>
        </div>
      </div>
    </div>
  </section>
</div>

<script>
(function(){
  var TOKEN_KEY = "wikidexCloudToken";
  var token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
  var currentMe = null;
  var currentTab = "market";
  var bidRefreshTimer = null;
  var collectionPage = 0;
  var marketPage = 1;
  var marketRows = [];
  var wishlistRows = [];
  var priorityRows = [];
  var priorityScanStarted = false;
  var priorityScanning = false;
  var priorityStats = {
    wishlistCount:0,
    scannedListings:0,
    wishlistListings:0,
    ownedExcluded:0,
    failedSegments:0
  };
  var cleanupPlan = null;
  var pricingProbe = null;

  function el(id){ return document.getElementById(id); }

  function setMsg(id,text,kind){
    var node=el(id);
    if(!node)return;
    node.textContent=text||"";
    node.className="msg"+(text?" show":"")+(kind?" "+kind:"");
  }

  async function api(path,options){
    options=options||{};
    var headers=new Headers(options.headers||{});
    if(token)headers.set("authorization","Bearer "+token);
    if(options.body&&!headers.has("content-type"))headers.set("content-type","application/json");
    var response=await fetch(path,Object.assign({},options,{headers:headers}));
    var data=await response.json().catch(function(){return {};});
    if(!response.ok){
      var error=new Error(data.error||("HTTP "+response.status));
      error.status=response.status;
      throw error;
    }
    return data;
  }

  function showLogin(){
    el("loginView").classList.remove("hidden");
    el("appView").classList.add("hidden");
    el("logout").classList.add("hidden");
    el("who").textContent="";
    if(bidRefreshTimer)clearInterval(bidRefreshTimer);
  }

  function updateSessionBadge(session){
    var badge=el("sessionBadge");
    if(!badge)return;
    badge.className="status "+(session&&session.connected?"good":"warn");
    badge.querySelector("span:last-child").textContent=
      session&&session.connected?"WikiMasters connecté":"WikiMasters non connecté";
  }

  function showApp(me){
    currentMe=me;
    el("loginView").classList.add("hidden");
    el("appView").classList.remove("hidden");
    el("logout").classList.remove("hidden");
    el("who").textContent=(me.account&&me.account.name)||"Compte WikiDex";
    updateSessionBadge(me.session);
    setTab(currentTab);
    if(bidRefreshTimer)clearInterval(bidRefreshTimer);
    bidRefreshTimer=setInterval(function(){
      if(currentTab==="autobid")loadBids(true);
    },5000);
  }

  function logout(){
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    token="";
    currentMe=null;
    showLogin();
  }

  async function loadMe(){
    if(!token)return showLogin();
    try{
      var me=await api("/api/me");
      showApp(me);
    }catch(e){
      logout();
    }
  }

  function setTab(name){
    currentTab=name;
    document.querySelectorAll(".tabPage").forEach(function(node){
      node.classList.toggle("hidden",node.id!=="tab-"+name);
    });
    document.querySelectorAll("#nav button").forEach(function(btn){
      btn.classList.toggle("active",btn.dataset.tab===name);
    });

    if(name==="collection")loadCollection();
    if(name==="wishlist")loadWishlist();
    if(name==="market"){
      loadMarket();
      if(!priorityScanStarted)scanPriorityMarket();
    }
    if(name==="autobid")loadBids();
  }

  function clearNode(node){
    while(node&&node.firstChild)node.removeChild(node.firstChild);
  }

  function imageBlock(src){
    if(src){
      var img=document.createElement("img");
      img.src=src;
      img.loading="lazy";
      img.alt="";
      img.referrerPolicy="no-referrer";
      return img;
    }
    var no=document.createElement("div");
    no.className="noimg";
    no.textContent="Image non disponible";
    return no;
  }

  function makeCard(card,options){
    options=options||{};
    var root=document.createElement("article");
    root.className="wikiCard";
    root.appendChild(imageBlock(card.image||""));

    var body=document.createElement("div");
    body.className="wikiCardBody";

    var title=document.createElement("div");
    title.className="wikiTitle";
    title.textContent=card.title||"Carte";
    body.appendChild(title);

    if(card.subtitle){
      var sub=document.createElement("div");
      sub.className="wikiSub";
      sub.textContent=card.subtitle;
      body.appendChild(sub);
    }

    if(card.rarity){
      var badge=document.createElement("span");
      badge.className="badge";
      badge.textContent=card.rarity;
      body.appendChild(badge);
    }

    if(options.starred){
      var starred=document.createElement("div");
      starred.className="muted";
      starred.style.fontSize="12px";
      starred.textContent="★ Favorite";
      body.appendChild(starred);
    }

    if(options.addWishlist&&card.id){
      var actions=document.createElement("div");
      actions.className="wikiActions";
      var add=document.createElement("button");
      add.className="btn small";
      add.textContent="♡ Wishlist";
      add.addEventListener("click",async function(){
        add.disabled=true;
        try{
          var result=await api("/api/wishlist",{
            method:"POST",
            body:JSON.stringify({cardId:card.id})
          });
          add.textContent=result.already?"Déjà dans la wishlist":"✓ Ajoutée";
        }catch(e){
          add.textContent="Erreur";
          setMsg("searchMsg",e.message,"error");
          add.disabled=false;
        }
      });
      actions.appendChild(add);
      body.appendChild(actions);
    }

    root.appendChild(body);
    return root;
  }

  async function runSearch(){
    var q=el("searchQ").value.trim();
    if(!q){
      setMsg("searchMsg","Entre un terme de recherche.","error");
      return;
    }

    var checked=Array.from(document.querySelectorAll("#rarityChoices input:checked"))
      .map(function(x){return x.value;});
    var params=new URLSearchParams();
    params.set("q",q);
    params.set("page","0");
    checked.forEach(function(r){params.append("rarity",r);});

    setMsg("searchMsg","Recherche…");
    clearNode(el("searchResults"));

    try{
      var data=await api("/api/cards/search?"+params.toString());
      setMsg("searchMsg",data.cards.length+" résultat(s).","success");
      data.cards.forEach(function(card){
        el("searchResults").appendChild(makeCard(card,{addWishlist:true}));
      });
    }catch(e){
      setMsg("searchMsg",e.message,"error");
    }
  }

  async function loadCollection(){
    var rarity=el("collectionRarity").value;
    var params=new URLSearchParams();
    params.set("page",String(collectionPage));
    if(rarity)params.set("rarity",rarity);

    el("collectionPageLabel").textContent="Page "+(collectionPage+1);
    setMsg("collectionMsg","Chargement…");
    clearNode(el("collectionResults"));

    try{
      var data=await api("/api/collection?"+params.toString());
      setMsg("collectionMsg",data.count+" carte(s) sur cette page.","success");
      data.cards.forEach(function(card){
        el("collectionResults").appendChild(makeCard(card,{starred:card.starred}));
      });
      el("collectionPrev").disabled=collectionPage<=0;
      el("collectionNext").disabled=data.count===0;
    }catch(e){
      setMsg("collectionMsg",e.message,"error");
    }
  }

  function renderWishlist(){
    var q=el("wishlistFilter").value.trim().toLowerCase();
    var rows=wishlistRows.filter(function(card){
      if(!q)return true;
      return String(card.title||"").toLowerCase().includes(q) ||
        String(card.rarity||"").toLowerCase().includes(q);
    });

    clearNode(el("wishlistResults"));
    rows.forEach(function(card){
      el("wishlistResults").appendChild(makeCard(card,{}));
    });
  }

  async function loadWishlist(){
    setMsg("wishlistMsg","Chargement…");
    try{
      var data=await api("/api/wishlist");
      wishlistRows=Array.isArray(data.cards)?data.cards:[];
      setMsg("wishlistMsg",data.count+" carte(s) dans la wishlist.","success");
      renderWishlist();
    }catch(e){
      wishlistRows=[];
      clearNode(el("wishlistResults"));
      setMsg("wishlistMsg",e.message,"error");
    }
  }

  function formatMoney(value){
    var n=Number(value);
    return Number.isFinite(n)?String(n):"—";
  }

  function formatEnd(value){
    if(!value)return "—";
    var d=new Date(value);
    return Number.isNaN(d.getTime())?String(value):d.toLocaleString("fr-FR");
  }

  function priorityPrice(row){
    var values=[row.effectiveBid,row.currentBid,row.baseAmount]
      .map(Number)
      .filter(Number.isFinite);
    return values.length?values[0]:Infinity;
  }

  function priorityEnd(row){
    var end=row&&row.endAt?Date.parse(row.endAt):NaN;
    return Number.isFinite(end)?end:Infinity;
  }

  function sortPriorityRows(){
    priorityRows.sort(function(a,b){
      return priorityEnd(a)-priorityEnd(b) ||
        priorityPrice(a)-priorityPrice(b) ||
        String(a.title||"").localeCompare(String(b.title||""),"fr");
    });
  }

  function renderPriorityMarket(){
    var root=el("priorityResults");
    clearNode(root);

    if(!priorityRows.length){
      var empty=document.createElement("p");
      empty.className="muted";
      empty.textContent=priorityScanning
        ?"Scan en cours…"
        :"Aucune enchère prioritaire trouvée.";
      root.appendChild(empty);
      return;
    }

    priorityRows.forEach(function(row,index){
      var line=document.createElement("div");
      line.className="marketRow";

      var title=document.createElement("div");
      var main=document.createElement("div");
      main.className="wikiTitle";
      main.textContent=(index+1)+". "+(row.title||"Carte");

      var meta=document.createElement("div");
      meta.className="muted";
      meta.style.fontSize="12px";
      meta.textContent=(row.rarity||"")+" · "+
        (row.alternatives>1?row.alternatives+" enchères trouvées":"1 enchère trouvée");
      title.append(main,meta);

      function cell(k,v){
        var d=document.createElement("div");
        var kk=document.createElement("div");
        kk.className="cellK";
        kk.textContent=k;
        var vv=document.createElement("div");
        vv.className="cellV";
        vv.textContent=v;
        d.append(kk,vv);
        return d;
      }

      var actions=document.createElement("div");
      actions.className="actions";
      var auto=document.createElement("button");
      auto.className="btn primary small";
      auto.textContent="AutoBid";
      auto.addEventListener("click",function(){
        el("listing").value=row.listingId;
        var base=Number(row.currentBid);
        if(Number.isFinite(base)){
          el("max").value=String(
            Math.max(Math.ceil(base*1.1),Math.floor(base)+1)
          );
        }
        setTab("autobid");
        el("max").focus();
        probeAutoBidPricing();
      });
      actions.appendChild(auto);

      line.append(
        title,
        cell("Prix",formatMoney(priorityPrice(row))),
        cell("Fin",formatEnd(row.endAt)),
        cell("Actuelle",formatMoney(row.currentBid)),
        cell("Vendeur",row.sellerName||"—"),
        actions
      );

      root.appendChild(line);
    });
  }

  function renderPrioritySummary(){
    var root=el("prioritySummary");
    clearNode(root);

    [
      ["Wishlist",priorityStats.wishlistCount],
      ["Enchères lues",priorityStats.scannedListings],
      ["Correspondances",priorityStats.wishlistListings],
      ["Déjà possédées écartées",priorityStats.ownedExcluded],
      ["Priorités",priorityRows.length]
    ].forEach(function(pair){
      var badge=document.createElement("span");
      badge.className="status";
      badge.textContent=pair[0]+" : "+pair[1];
      root.appendChild(badge);
    });
  }

  function mergePriorityMatches(rows){
    var byCard=new Map();

    priorityRows.forEach(function(row){
      var key=String(row.cardId||"");
      if(key)byCard.set(key,row);
    });

    (Array.isArray(rows)?rows:[]).forEach(function(row){
      var key=String(row.cardId||"");
      if(!key)return;

      var old=byCard.get(key);
      if(!old){
        byCard.set(key,Object.assign({},row,{alternatives:1}));
        return;
      }

      var alternatives=(Number(old.alternatives)||1)+1;
      var price=priorityPrice(row);
      var oldPrice=priorityPrice(old);
      var end=priorityEnd(row);
      var oldEnd=priorityEnd(old);

      if(price<oldPrice||(price===oldPrice&&end<oldEnd)){
        byCard.set(
          key,
          Object.assign({},row,{alternatives:alternatives})
        );
      }else{
        old.alternatives=alternatives;
        byCard.set(key,old);
      }
    });

    priorityRows=Array.from(byCard.values());
    sortPriorityRows();
  }

  async function scanPriorityMarket(){
    if(priorityScanning)return;
    priorityScanning=true;
    priorityScanStarted=true;
    priorityRows=[];
    priorityStats={
      wishlistCount:0,
      scannedListings:0,
      wishlistListings:0,
      ownedExcluded:0,
      failedSegments:0
    };
    renderPrioritySummary();
    renderPriorityMarket();

    var btn=el("scanPriorityMarket");
    if(btn)btn.disabled=true;
    setMsg("priorityMsg","Lecture de la wishlist…");

    try{
      var start=await api("/api/marketplace/priority/start",{
        method:"POST",
        body:JSON.stringify({})
      });

      priorityStats.wishlistCount=Number(start.wishlistCount)||0;
      renderPrioritySummary();

      if(!priorityStats.wishlistCount){
        setMsg("priorityMsg","Ta wishlist WikiMasters est vide.","success");
        return;
      }

      var offset=0;
      var blocks=0;
      var maxBlocks=250;

      while(offset!==null&&blocks<maxBlocks){
        setMsg(
          "priorityMsg",
          "Scan du marché… bloc "+(blocks+1)+
          " · "+priorityStats.scannedListings+" enchère(s) lue(s)"
        );

        var part=await api(
          "/api/marketplace/priority?scan="+
          encodeURIComponent(start.scanId)+
          "&offset="+offset
        );

        priorityStats.scannedListings+=Number(part.scannedListings)||0;
        priorityStats.wishlistListings+=Number(part.wishlistListings)||0;
        priorityStats.ownedExcluded+=Number(part.ownedExcluded)||0;
        priorityStats.failedSegments+=Number(part.failedSegments)||0;

        mergePriorityMatches(part.matches);
        renderPrioritySummary();
        renderPriorityMarket();

        offset=part.nextOffset;
        blocks++;
      }

      var suffix="";
      if(priorityStats.failedSegments){
        suffix+=" · "+priorityStats.failedSegments+
          " petit(s) segment(s) du marché n’ont pas pu être lus";
      }
      if(blocks>=maxBlocks&&offset!==null){
        suffix+=" · scan arrêté à la limite de sécurité";
      }

      setMsg(
        "priorityMsg",
        priorityRows.length+
          " carte(s) wishlist non possédée(s) actuellement trouvée(s) sur le marché. "+
          "Pour chaque carte : prix le plus bas, puis fin la plus proche. "+
          "Liste finale : fin la plus proche → prix le plus bas"+
          suffix+".",
        priorityStats.failedSegments?"":"success"
      );
    }catch(e){
      setMsg("priorityMsg",e.message,"error");
    }finally{
      priorityScanning=false;
      if(btn)btn.disabled=false;
      renderPrioritySummary();
      renderPriorityMarket();
    }
  }

  function renderMarket(){
    var q=el("marketFilter").value.trim().toLowerCase();
    var rows=marketRows.filter(function(row){
      if(!q)return true;
      return [
        row.title,row.rarity,row.sellerName,row.category
      ].some(function(x){return String(x||"").toLowerCase().includes(q);});
    });

    var root=el("marketResults");
    clearNode(root);

    if(!rows.length){
      var empty=document.createElement("p");
      empty.className="muted";
      empty.textContent="Aucune enchère sur cette page.";
      root.appendChild(empty);
      return;
    }

    rows.forEach(function(row){
      var line=document.createElement("div");
      line.className="marketRow";

      var title=document.createElement("div");
      var t=document.createElement("div");
      t.className="wikiTitle";
      t.textContent=row.title||"Carte";
      var meta=document.createElement("div");
      meta.className="muted";
      meta.style.fontSize="12px";
      meta.textContent=(row.rarity||"")+" · "+(row.sellerName||"vendeur");
      title.append(t,meta);

      function cell(k,v){
        var d=document.createElement("div");
        var kk=document.createElement("div");
        kk.className="cellK";
        kk.textContent=k;
        var vv=document.createElement("div");
        vv.className="cellV";
        vv.textContent=v;
        d.append(kk,vv);
        return d;
      }

      var actions=document.createElement("div");
      actions.className="actions";
      var auto=document.createElement("button");
      auto.className="btn primary small";
      auto.textContent="AutoBid";
      auto.addEventListener("click",function(){
        el("listing").value=row.listingId;
        var base=Number(row.currentBid);
        if(Number.isFinite(base))el("max").value=String(Math.max(Math.ceil(base*1.1),Math.floor(base)+1));
        setTab("autobid");
        el("max").focus();
        probeAutoBidPricing();
      });
      actions.appendChild(auto);

      line.append(
        title,
        cell("Actuelle",formatMoney(row.currentBid)),
        cell("Base",formatMoney(row.baseAmount)),
        cell("Fin",formatEnd(row.endAt)),
        cell("État",row.status||"—"),
        actions
      );
      root.appendChild(line);
    });
  }

  async function loadMarket(){
    el("marketPageLabel").textContent="Page "+marketPage;
    setMsg("marketMsg","Chargement…");

    try{
      var data=await api("/api/marketplace?page="+marketPage+"&limit=50&sort=recent");
      marketRows=Array.isArray(data.auctions)?data.auctions:[];
      setMsg("marketMsg",marketRows.length+" enchère(s) chargée(s).","success");
      renderMarket();
      el("marketPrev").disabled=marketPage<=1;
      el("marketNext").disabled=!data.hasMore;
    }catch(e){
      marketRows=[];
      renderMarket();
      setMsg("marketMsg",e.message,"error");
    }
  }

  function renderCleanupPlan(data){
    cleanupPlan=data;

    el("cleanupScanned").textContent=String(data.scanned||0);
    el("cleanupDiscardable").textContent=String(
      Array.isArray(data.candidates)?data.candidates.length:0
    );

    var protectedTotal=
      Number(data.protectedWishlist||0)+
      Number(data.protectedPending||0)+
      Number(data.protectedStarred||0);
    el("cleanupProtected").textContent=String(protectedTotal);

    el("cleanupDetails").textContent=
      "Wishlist : "+(data.protectedWishlist||0)+
      " · Transactions : "+(data.protectedPending||0)+
      " · Étoilées : "+(data.protectedStarred||0)+
      " · Pages lues : "+(data.pagesRead||0);

    var root=el("cleanupCandidates");
    clearNode(root);

    var rows=Array.isArray(data.candidates)?data.candidates:[];
    if(!rows.length){
      var empty=document.createElement("p");
      empty.className="muted";
      empty.textContent="Aucune carte commune à défausser.";
      root.appendChild(empty);
    }else{
      rows.forEach(function(card){
        var line=document.createElement("div");
        line.style.padding="7px 0";
        line.style.borderTop="1px solid var(--line)";
        line.textContent=card.title||card.userCardId;
        root.appendChild(line);
      });
    }

    el("cleanupConfirm").checked=false;
    el("cleanupExecute").disabled=true;
  }

  async function analyzeCleanup(){
    var btn=el("cleanupAnalyze");
    btn.disabled=true;
    cleanupPlan=null;
    el("cleanupExecute").disabled=true;
    setMsg("cleanupMsg","Analyse des cartes communes, wishlist et transactions…");
    setMsg("cleanupRunMsg","");

    try{
      var data=await api("/api/cleanup/analyze",{
        method:"POST",
        body:JSON.stringify({
          protectStarred:el("cleanupProtectStarred").checked
        })
      });

      renderCleanupPlan(data);
      setMsg(
        "cleanupMsg",
        data.candidates.length+
          " carte(s) commune(s) défaussable(s). Aucune carte n’a été supprimée.",
        "success"
      );
    }catch(e){
      setMsg("cleanupMsg",e.message,"error");
    }finally{
      btn.disabled=false;
    }
  }

  async function executeCleanup(){
    if(!cleanupPlan||!cleanupPlan.planId)return;

    if(!el("cleanupConfirm").checked){
      return setMsg(
        "cleanupRunMsg",
        "Coche la confirmation avant la défausse.",
        "error"
      );
    }

    var count=Array.isArray(cleanupPlan.candidates)
      ?cleanupPlan.candidates.length
      :0;

    if(!count)return;

    if(!confirm(
      "Défausser définitivement "+count+
      " carte(s) commune(s) ?\\n\\n"+
      "Wishlist, transactions et cartes étoilées protégées ne seront pas touchées."
    ))return;

    var btn=el("cleanupExecute");
    btn.disabled=true;
    var processed=0;

    try{
      while(true){
        setMsg(
          "cleanupRunMsg",
          "Défausse en cours… "+processed+"/"+count
        );

        var data=await api("/api/cleanup/execute",{
          method:"POST",
          body:JSON.stringify({
            planId:cleanupPlan.planId,
            confirm:"DISCARD_COMMONS",
            batchSize:10
          })
        });

        processed+=Number(data.processed)||0;

        if(data.stoppedAfterFailures){
          throw new Error(
            "Arrêt de sécurité après 3 échecs consécutifs. Aucun POST en échec n’a été retenté."
          );
        }

        if(data.complete){
          setMsg(
            "cleanupRunMsg",
            "Nettoyage terminé. "+processed+" tentative(s) traitée(s).",
            "success"
          );
          await analyzeCleanup();
          break;
        }

        if(!data.processed && data.remaining){
          throw new Error(
            "Le nettoyage n’avance plus. Relance une analyse avant de continuer."
          );
        }
      }
    }catch(e){
      setMsg("cleanupRunMsg",e.message,"error");
    }finally{
      btn.disabled=!cleanupPlan||
        !el("cleanupConfirm").checked||
        !(cleanupPlan.candidates&&cleanupPlan.candidates.length);
    }
  }

  async function probeAutoBidPricing(){
    var listing=el("listing").value.trim();
    pricingProbe=null;
    el("pricingActions").classList.add("hidden");
    el("pricingValue").textContent="Recherche…";
    el("pricingMeta").textContent="";

    if(!listing){
      el("pricingValue").textContent="ID ou URL d’enchère requis";
      return;
    }

    try{
      var data=await api(
        "/api/pricing/probe?listing="+encodeURIComponent(listing)
      );

      pricingProbe=data;

      if(Number.isFinite(Number(data.average))){
        var value=Number(data.average);
        el("pricingValue").textContent=value+" Wikibidous";
        el("pricingMeta").textContent=
          (data.rarity?data.rarity+" · ":"")+
          "moyenne des ventes WikiMasters";
        el("pricingActions").classList.remove("hidden");
        return;
      }

      el("pricingValue").textContent="Moyenne indisponible";

      if(Array.isArray(data.averages)&&data.averages.length){
        el("pricingMeta").textContent=
          "Moyennes disponibles : "+
          data.averages.map(function(x){
            return x.rarity+"="+x.average;
          }).join(" · ");
      }else{
        el("pricingMeta").textContent=
          "Aucune moyenne renvoyée par WikiMasters pour cette carte.";
      }
    }catch(e){
      el("pricingValue").textContent="Recherche impossible";
      el("pricingMeta").textContent=e.message;
    }
  }


  function statusLabel(bid){
    if(bid.running)return "Actif";
    if(bid.lastAction==="cap-reached")return "Plafond atteint";
    if(bid.lastAction==="finished-won")return "Gagnée";
    if(bid.finishedAt)return "Terminée";
    if(bid.stoppedAt)return "Arrêté";
    return bid.lastAction||"Inactif";
  }

  async function loadBids(silent){
    var root=el("bids");
    try{
      var data=await api("/api/autobids");
      clearNode(root);

      if(!data.items||!data.items.length){
        var empty=document.createElement("p");
        empty.className="muted";
        empty.textContent="Aucun AutoBid configuré.";
        root.appendChild(empty);
        return;
      }

      data.items.forEach(function(bid){
        var row=document.createElement("div");
        row.className="auctionRow";

        var title=document.createElement("div");
        var main=document.createElement("div");
        main.className="wikiTitle";
        main.textContent=bid.title||bid.listingId;
        var id=document.createElement("div");
        id.className="muted";
        id.style.fontSize="11px";
        id.textContent=bid.listingId;
        title.append(main,id);

        function cell(k,v){
          var d=document.createElement("div");
          var kk=document.createElement("div");
          kk.className="cellK";
          kk.textContent=k;
          var vv=document.createElement("div");
          vv.className="cellV";
          vv.textContent=v;
          d.append(kk,vv);
          return d;
        }

        var actions=document.createElement("div");
        actions.className="actions";
        var stop=document.createElement("button");
        stop.className="btn danger small";
        stop.textContent="Arrêter";
        stop.disabled=!bid.running;
        stop.addEventListener("click",async function(){
          stop.disabled=true;
          try{
            await api("/api/autobids/stop?listing="+encodeURIComponent(bid.listingId),{method:"POST"});
            await loadBids();
          }catch(e){
            alert(e.message);
            stop.disabled=false;
          }
        });
        actions.appendChild(stop);

        row.append(
          title,
          cell("Actuelle",formatMoney(bid.currentBid)),
          cell("Suivante",formatMoney(bid.nextBid)),
          cell("Plafond",formatMoney(bid.max)),
          cell("État",statusLabel(bid)),
          actions
        );
        root.appendChild(row);
      });
    }catch(e){
      if(!silent){
        clearNode(root);
        var box=document.createElement("div");
        box.className="errorBox";
        box.textContent=e.message;
        root.appendChild(box);
      }
    }
  }

  document.querySelectorAll("#nav button").forEach(function(btn){
    btn.addEventListener("click",function(){setTab(btn.dataset.tab);});
  });

  el("login").addEventListener("click",async function(){
    setMsg("loginMsg","");
    var candidate=el("token").value.trim();
    if(!candidate)return setMsg("loginMsg","Clé requise.","error");
    token=candidate;
    try{
      var me=await api("/api/me");
      if(el("rememberMe").checked){
        localStorage.setItem(TOKEN_KEY,token);
        sessionStorage.removeItem(TOKEN_KEY);
      }else{
        sessionStorage.setItem(TOKEN_KEY,token);
        localStorage.removeItem(TOKEN_KEY);
      }
      el("token").value="";
      showApp(me);
    }catch(e){
      token="";
      setMsg("loginMsg",e.message,"error");
    }
  });

  el("logout").addEventListener("click",logout);
  el("settingsLogout").addEventListener("click",logout);

  el("createUser").addEventListener("click",async function(){
    setMsg("adminMsg","");
    var adminKey=el("adminKey").value.trim();
    var name=el("newUserName").value.trim();
    if(!adminKey||!name)return setMsg("adminMsg","Clé admin et nom requis.","error");

    try{
      var response=await fetch("/api/admin/users",{
        method:"POST",
        headers:{
          "content-type":"application/json",
          "x-wikidex-admin-key":adminKey
        },
        body:JSON.stringify({name:name})
      });
      var data=await response.json();
      if(!response.ok)throw new Error(data.error||"Erreur");
      setMsg(
        "adminMsg",
        "Compte créé pour "+data.account.name+"\\n\\nClé à transmettre UNE SEULE FOIS :\\n"+data.token,
        "success"
      );
      el("newUserName").value="";
    }catch(e){
      setMsg("adminMsg",e.message,"error");
    }
  });

  el("connectWiki").addEventListener("click",async function(){
    setMsg("sessionMsg","");
    var cookie=el("wikiCookie").value.trim();
    var authorization=el("wikiAuthorization").value.trim();
    if(!cookie&&!authorization)return setMsg("sessionMsg","Cookie ou Authorization requis.","error");

    try{
      var data=await api("/api/session",{
        method:"PUT",
        body:JSON.stringify({cookie:cookie,authorization:authorization})
      });
      el("wikiCookie").value="";
      el("wikiAuthorization").value="";
      updateSessionBadge(data);
      if(currentMe)currentMe.session=data;
      setMsg("sessionMsg","Session WikiMasters validée et chiffrée.","success");
      priorityScanStarted=false;
    }catch(e){
      setMsg("sessionMsg",e.message,"error");
    }
  });

  el("disconnectWiki").addEventListener("click",async function(){
    if(!confirm("Déconnecter la session WikiMasters de WikiDex Cloud ?"))return;
    try{
      var data=await api("/api/session",{method:"DELETE"});
      updateSessionBadge(data);
      if(currentMe)currentMe.session=data;
      setMsg("sessionMsg","Session supprimée du coffre.","success");
    }catch(e){
      setMsg("sessionMsg",e.message,"error");
    }
  });

  el("probePricing").addEventListener("click",probeAutoBidPricing);
  document.querySelectorAll("[data-average-multiplier]").forEach(function(btn){
    btn.addEventListener("click",function(){
      if(!pricingProbe)return;
      var average=Number(pricingProbe.average);
      var multiplier=Number(btn.dataset.averageMultiplier);
      if(Number.isFinite(average)&&average>0&&Number.isFinite(multiplier)){
        el("max").value=String(Math.max(1,Math.round(average*multiplier)));
      }
    });
  });
  el("listing").addEventListener("input",function(){
    pricingProbe=null;
    el("pricingValue").textContent="Non recherchée";
    el("pricingMeta").textContent="";
    el("pricingActions").classList.add("hidden");
  });

  el("startBid").addEventListener("click",async function(){
    setMsg("bidMsg","");
    var listing=el("listing").value.trim();
    var max=Number(el("max").value);
    if(!listing||!Number.isFinite(max)||max<=0){
      return setMsg("bidMsg","Enchère et plafond valides requis.","error");
    }
    if(!el("confirmReal").checked){
      return setMsg("bidMsg","Confirme explicitement l’autorisation de vraies enchères.","error");
    }

    try{
      var data=await api("/api/autobids/start",{
        method:"POST",
        body:JSON.stringify({
          listing:listing,
          max:max,
          confirm:"REAL_BIDS"
        })
      });
      el("listing").value="";
      el("max").value="";
      el("confirmReal").checked=false;
      setMsg("bidMsg","AutoBid armé : "+(data.title||data.listingId),"success");
      await loadBids();
    }catch(e){
      setMsg("bidMsg",e.message,"error");
    }
  });

  el("searchBtn").addEventListener("click",runSearch);
  el("searchQ").addEventListener("keydown",function(e){if(e.key==="Enter")runSearch();});

  el("refreshCollection").addEventListener("click",function(){collectionPage=0;loadCollection();});
  el("collectionRarity").addEventListener("change",function(){collectionPage=0;loadCollection();});
  el("collectionPrev").addEventListener("click",function(){
    if(collectionPage>0){collectionPage--;loadCollection();}
  });
  el("collectionNext").addEventListener("click",function(){collectionPage++;loadCollection();});

  el("refreshWishlist").addEventListener("click",loadWishlist);
  el("wishlistFilter").addEventListener("input",renderWishlist);

  el("scanPriorityMarket").addEventListener("click",scanPriorityMarket);
  el("refreshMarket").addEventListener("click",loadMarket);
  el("marketFilter").addEventListener("input",renderMarket);
  el("marketPrev").addEventListener("click",function(){
    if(marketPage>1){marketPage--;loadMarket();}
  });
  el("marketNext").addEventListener("click",function(){marketPage++;loadMarket();});

  el("cleanupAnalyze").addEventListener("click",analyzeCleanup);
  el("cleanupConfirm").addEventListener("change",function(){
    el("cleanupExecute").disabled=
      !cleanupPlan||
      !el("cleanupConfirm").checked||
      !(cleanupPlan.candidates&&cleanupPlan.candidates.length);
  });
  el("cleanupExecute").addEventListener("click",executeCleanup);

  el("refreshBids").addEventListener("click",function(){loadBids();});

  loadMe();
})();
</script>
</body>
</html>`;
}
