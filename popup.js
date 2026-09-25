
const $=id=>document.getElementById(id);
const uid=()=>crypto.randomUUID();
let tab='results', rawResults=[], results=[], selected=new Set(), cols=[], page=0, pageInfo=null, lastDebug=null, openCol=null, currentQuery='';

const AUTOBID_KEY='wikidexAutoBidsV010';
const WIKIBIDOU_BALANCE_KEY='wikidexWikiBidouBalanceV1';
const AUTOBID_INCREMENT_PCT=10;
let autoBids=[];
let autoTickRunning=false;
let autoTimer=null;
let autoDraft={listing:'',max:''};
let suggestionDrafts={};
let marketSuggestions=[];
let marketScanInfo={status:'',scannedListings:0,wishlistMatches:0,sourceUrl:'',startedAt:0,progress:null};
let wikibidouBalance={amount:null,status:'idle',updatedAt:0,error:''};
let autoEngineStatus={active:false,enabledCount:0,lastTickAt:0,reason:'unknown'};
let autoSort='priority';
let cleanupProtectStarred=true;
let cleanupState={
  status:'idle',
  commons:[],
  toDiscard:[],
  wishlistCount:0,
  protectedWishlist:0,
  protectedPending:0,
  protectedStarred:0,
  pagesRead:0,
  scanned:0,
  done:0,
  failed:0,
  error:''
};


const UI_STATE_KEY='wikidexUiStateV077';
let restoring=false;

async function persistUiState(){
  if(restoring)return;
  const state={
    tab,
    resultIds:rawResults.map(c=>c.id),
    selectedIds:[...selected],
    page,
    pageInfo,
    openCol,
    currentQuery,
    q:$('q')?.value||currentQuery||'',
    rarities:[...document.querySelectorAll('.rarityChip.active')].map(b=>b.dataset.rarity),
    autoDraft:{...autoDraft},
    suggestionDrafts:{...suggestionDrafts},
    marketSuggestions,
    marketScanInfo,
    autoSort,
    cleanupProtectStarred,
    savedAt:Date.now()
  };
  await chrome.storage.local.set({[UI_STATE_KEY]:state}).catch(()=>{});
}

async function restoreUiState(){
  restoring=true;
  try{
    let obj=await chrome.storage.local.get(UI_STATE_KEY);
    let state=obj?.[UI_STATE_KEY];
    if(!state){
      const old=await chrome.storage.session.get(UI_STATE_KEY).catch(()=>({}));
      state=old?.[UI_STATE_KEY]||null;
      if(state)await chrome.storage.local.set({[UI_STATE_KEY]:state}).catch(()=>{});
    }
    if(!state)return;

    tab=state.tab||'results';
    page=Number.isInteger(state.page)?state.page:0;
    pageInfo=state.pageInfo||null;
    openCol=state.openCol||null;
    currentQuery=state.currentQuery||state.q||'';
    selected=new Set(state.selectedIds||[]);
    if(state.autoDraft&&typeof state.autoDraft==='object') autoDraft={...autoDraft,...state.autoDraft};
    if(state.suggestionDrafts&&typeof state.suggestionDrafts==='object') suggestionDrafts={...state.suggestionDrafts};
    if(Array.isArray(state.marketSuggestions)){
      const now=Date.now();
      marketSuggestions=state.marketSuggestions.filter(x=>{
        if(!x?.endAt)return true;
        const end=Date.parse(x.endAt);
        return !Number.isFinite(end)||end>now;
      });
    }
    if(['priority','end','priceAsc','priceDesc','maxAsc','track','autobid'].includes(state.autoSort)) autoSort=state.autoSort;
    if(typeof state.cleanupProtectStarred==='boolean') cleanupProtectStarred=state.cleanupProtectStarred;
    if(state.marketScanInfo&&typeof state.marketScanInfo==='object'){
      marketScanInfo={...state.marketScanInfo,restored:true};
      if(marketScanInfo.status==='scan') marketScanInfo.status=marketSuggestions.length?'done':'';
      marketScanInfo.uniqueCards=marketSuggestions.length;
    }

    if($('q'))$('q').value=state.q||currentQuery||'';
    const restoredRarities=new Set(
      Array.isArray(state.rarities) && state.rarities.length
        ? state.rarities
        : ['L','UR','SR','R']
    );
    document.querySelectorAll('.rarityChip').forEach(b=>{
      b.classList.toggle('active',restoredRarities.has(b.dataset.rarity));
    });

    const ids=state.resultIds||[];
    if(ids.length){
      const r=await chrome.runtime.sendMessage({type:'DB_GET_CARDS',ids});
      rawResults=r.items||[];
    }else{
      rawResults=[];
    }
    applyFilters();
  }finally{
    restoring=false;
  }
}



async function wikiTab(){
  const tabs=await chrome.tabs.query({url:['https://www.wiki-masters.com/*','https://wiki-masters.com/*']});
  return tabs.find(t=>t.active)||tabs[0]||null;
}

function formatWikiBidous(value){
  const n=Number(value);
  if(!Number.isFinite(n))return '—';
  return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(n);
}

async function restoreWikiBidouBalance(){
  const obj=await chrome.storage.local.get(WIKIBIDOU_BALANCE_KEY).catch(()=>({}));
  const state=obj?.[WIKIBIDOU_BALANCE_KEY];
  if(!state||!Number.isFinite(Number(state.amount)))return;
  wikibidouBalance={
    amount:Number(state.amount),
    status:'cached',
    updatedAt:Number(state.updatedAt)||0,
    error:''
  };
}

function updateWikiBidouBalanceDom(){
  const amountEl=$('wikibidouAmount');
  const metaEl=$('wikibidouMeta');
  const btn=$('refreshWikiBidous');
  if(!amountEl)return;

  amountEl.textContent=wikibidouBalance.status==='loading' && wikibidouBalance.amount==null
    ? '…'
    : formatWikiBidous(wikibidouBalance.amount);

  if(metaEl){
    if(wikibidouBalance.status==='loading'){
      metaEl.textContent='Actualisation…';
    }else if(wikibidouBalance.error){
      metaEl.textContent='Dernier solde connu' + (wikibidouBalance.updatedAt
        ? ' · '+new Date(wikibidouBalance.updatedAt).toLocaleTimeString('fr-FR')
        : '');
    }else if(wikibidouBalance.updatedAt){
      metaEl.textContent='Mis à jour à '+new Date(wikibidouBalance.updatedAt).toLocaleTimeString('fr-FR');
    }else{
      metaEl.textContent='Solde WikiMasters';
    }
  }

  if(btn)btn.disabled=wikibidouBalance.status==='loading';
}

async function refreshWikiBidouBalance({silent=false}={}){
  const previousAmount=wikibidouBalance.amount;
  wikibidouBalance={...wikibidouBalance,status:'loading',error:''};
  updateWikiBidouBalanceDom();

  try{
    const tabs=await marketplaceTabs('');
    if(!tabs.length)throw new Error('Ouvre WikiMasters dans un onglet.');

    let found=null;

    for(const t of tabs){
      try{
        const out=await chrome.scripting.executeScript({
          target:{tabId:t.id},
          func:()=>{
            const visible=el=>{
              if(!(el instanceof Element))return false;
              const r=el.getBoundingClientRect();
              const st=getComputedStyle(el);
              return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden';
            };

            const parseNumber=raw=>{
              let x=String(raw||'').replace(/[\s\u00A0\u202F]/g,'').trim();
              if(!x)return null;

              const punct=[...x].filter(ch=>ch===','||ch==='.').length;
              if(punct){
                const lastComma=x.lastIndexOf(',');
                const lastDot=x.lastIndexOf('.');
                const last=Math.max(lastComma,lastDot);
                const decimals=x.length-last-1;

                if(decimals===1||decimals===2){
                  const intPart=x.slice(0,last).replace(/[.,]/g,'');
                  const decPart=x.slice(last+1).replace(/[.,]/g,'');
                  x=intPart+'.'+decPart;
                }else{
                  x=x.replace(/[.,]/g,'');
                }
              }

              const n=Number(x);
              return Number.isFinite(n)?n:null;
            };

            const extract=text=>{
              const src=String(text||'').replace(/\s+/g,' ').trim();
              if(!/wikibidou/i.test(src))return null;

              const before=src.match(/([0-9][0-9\s\u00A0\u202F.,]{0,24})\s*wikibidous?/i);
              if(before){
                const n=parseNumber(before[1]);
                if(n!==null)return n;
              }

              const after=src.match(/wikibidous?[^0-9]{0,24}([0-9][0-9\s\u00A0\u202F.,]{0,24})/i);
              if(after){
                const n=parseNumber(after[1]);
                if(n!==null)return n;
              }

              return null;
            };

            const candidates=[];
            const nodes=[...document.querySelectorAll('header,nav,button,a,div,span,[aria-label],[title]')];

            for(const el of nodes){
              if(!visible(el))continue;

              const own=[
                el.innerText||'',
                el.getAttribute?.('aria-label')||'',
                el.getAttribute?.('title')||''
              ].join(' ').trim();

              if(!/wikibidou/i.test(own))continue;

              const variants=[el,el.parentElement,el.parentElement?.parentElement].filter(Boolean);
              for(let depth=0;depth<variants.length;depth++){
                const node=variants[depth];
                const txt=[
                  node.innerText||'',
                  node.getAttribute?.('aria-label')||'',
                  node.getAttribute?.('title')||''
                ].join(' ');

                const amount=extract(txt);
                if(amount===null)continue;

                const r=node.getBoundingClientRect();
                let score=100-depth*10;
                if(node.closest('header,nav'))score+=50;
                if(r.top>=0&&r.top<180)score+=25;
                if(txt.length<120)score+=20;

                candidates.push({amount,score,text:txt.slice(0,160)});
              }
            }

            candidates.sort((a,b)=>b.score-a.score);
            return candidates[0]||null;
          }
        });

        const candidate=out?.[0]?.result||null;
        if(candidate&&Number.isFinite(Number(candidate.amount))){
          found={...candidate,tabId:t.id};
          break;
        }
      }catch{}
    }

    if(!found)throw new Error('Solde Wikibidous introuvable sur la page WikiMasters.');

    wikibidouBalance={
      amount:Number(found.amount),
      status:'ok',
      updatedAt:Date.now(),
      error:''
    };

    await chrome.storage.local.set({
      [WIKIBIDOU_BALANCE_KEY]:{
        amount:wikibidouBalance.amount,
        updatedAt:wikibidouBalance.updatedAt
      }
    }).catch(()=>{});
  }catch(e){
    wikibidouBalance={
      amount:previousAmount,
      status:'error',
      updatedAt:wikibidouBalance.updatedAt||0,
      error:e.message||String(e)
    };
    if(!silent)$('status').textContent='Wikibidous : '+wikibidouBalance.error;
  }

  updateWikiBidouBalanceDom();
}

async function marketplaceTabs(listingId=''){
  const www=await chrome.tabs.query({url:['https://www.wiki-masters.com/*']});
  const bare=await chrome.tabs.query({url:['https://wiki-masters.com/*']});

  const all=[...www,...bare];
  const seen=new Set();
  const unique=all.filter(t=>{
    if(seen.has(t.id))return false;
    seen.add(t.id);
    return true;
  });

  const needle=listingId?`/marketplace/${listingId}`:'';

  // Prefer:
  // 1. exact auction page on www
  // 2. active www tab
  // 3. any www tab
  // 4. bare-domain tabs as fallback
  unique.sort((a,b)=>{
    function score(t){
      let s=0;
      const u=String(t.url||'');
      if(u.startsWith('https://www.wiki-masters.com/'))s+=100;
      if(needle && u.includes(needle))s+=80;
      if(t.active)s+=20;
      if(t.status==='complete')s+=5;
      return s;
    }
    return score(b)-score(a);
  });

  return unique;
}

async function runWikiCollectionPage(tabId,page){
  const executed=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[page],
    func:async page=>{
      const url=new URL('https://www.wiki-masters.com/api/my-collection');
      url.searchParams.set('sort','rarity');
      url.searchParams.set('rarity','C');
      url.searchParams.set('page',String(page));
      url.searchParams.set('stats','0');

      const waits=[0,500,1400];
      let last=null;

      for(const wait of waits){
        if(wait)await new Promise(r=>setTimeout(r,wait));

        try{
          const r=await fetch(url.toString(),{
            method:'GET',
            headers:{accept:'*/*'},
            credentials:'include',
            cache:'no-store'
          });

          const text=await r.text();
          let data=null;
          try{data=text?JSON.parse(text):null}catch{data=text}

          last={
            ok:r.ok,
            status:r.status,
            data,
            page
          };

          if(r.ok)return last;
          if(![429,500,502,503,504].includes(r.status))return last;
        }catch(e){
          last={
            ok:false,
            status:0,
            error:e?.message||String(e),
            page
          };
        }
      }

      return last;
    }
  });

  return executed?.[0]?.result||null;
}

async function runWikiDiscardUserCard(tabId,userCardId){
  const executed=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[userCardId],
    func:async id=>{
      // Destructive action: EXACTLY ONE POST attempt. Never retry.
      const url=
        'https://www.wiki-masters.com/api/user-cards/'+
        encodeURIComponent(id)+
        '/discard';

      try{
        const r=await fetch(url,{
          method:'POST',
          headers:{accept:'*/*'},
          credentials:'include',
          cache:'no-store'
        });

        const text=await r.text();
        let data=null;
        try{data=text?JSON.parse(text):null}catch{data=text}

        return {
          ok:r.ok,
          status:r.status,
          data,
          text
        };
      }catch(e){
        return {
          ok:false,
          status:0,
          error:e?.message||String(e)
        };
      }
    }
  });

  return executed?.[0]?.result||null;
}

async function loadAllCommonUserCards(tabId){
  const items=[];
  const seenUserCards=new Set();
  const pendingTradeIds=new Set();
  let pagesRead=0;

  for(let page=0;page<100;page++){
    const r=await runWikiCollectionPage(tabId,page);
    if(!r)throw new Error('Aucune réponse de la collection WikiMasters.');
    if(!r.ok){
      throw new Error(
        `Lecture collection impossible (HTTP ${r.status||0}) page ${page}.`
      );
    }

    const rows=Array.isArray(r.data?.collection)
      ? r.data.collection
      : [];

    for(const x of Array.isArray(r.data?.pendingTradeCardIds)
      ? r.data.pendingTradeCardIds
      : []){
      if(x)pendingTradeIds.add(String(x));
    }

    if(!rows.length){
      pagesRead=page+1;
      break;
    }

    let added=0;

    for(const row of rows){
      const userCardId=String(row?.id||'');
      if(!userCardId || seenUserCards.has(userCardId))continue;

      seenUserCards.add(userCardId);
      items.push(row);
      added++;
    }

    pagesRead=page+1;

    // The endpoint does not expose a reliable total. If page=N returns
    // no new owned-card IDs, pagination is exhausted or page is ignored.
    if(!added)break;
  }

  return {
    items,
    pendingTradeIds,
    pagesRead
  };
}

async function analyzeCommonCleanup(){
  cleanupState={
    ...cleanupState,
    status:'scan',
    commons:[],
    toDiscard:[],
    pagesRead:0,
    scanned:0,
    done:0,
    failed:0,
    error:''
  };
  render();

  try{
    const tabs=await marketplaceTabs('');
    const tabInfo=tabs.find(t=>!String(t.url||'').includes('#wikidex-sync'));
    if(!tabInfo)throw new Error('Garde au moins un onglet WikiMasters ouvert.');

    $('status').textContent='Nettoyage : lecture de la wishlist…';

    const wishlist=await chrome.runtime.sendMessage({
      type:'WISHLIST_GET_ALL',
      tabId:tabInfo.id
    });

    if(wishlist?.error)throw new Error(wishlist.error);

    const wishlistIds=new Set(
      (Array.isArray(wishlist?.cardIds)?wishlist.cardIds:[])
        .map(normalizeCardKey)
        .filter(Boolean)
    );

    $('status').textContent='Nettoyage : lecture des cartes communes…';

    const collection=await loadAllCommonUserCards(tabInfo.id);
    const pending=collection.pendingTradeIds;

    const commons=collection.items.filter(row=>
      String(row?.card?.rarity||'').toUpperCase()==='C'
    );

    const toDiscard=[];
    let protectedWishlist=0;
    let protectedPending=0;
    let protectedStarred=0;

    for(const row of commons){
      const cardId=normalizeCardKey(row?.card_id||row?.card?.id);
      const userCardId=String(row?.id||'');

      if(cardId && wishlistIds.has(cardId)){
        protectedWishlist++;
        continue;
      }

      if(
        pending.has(userCardId) ||
        (cardId && pending.has(cardId))
      ){
        protectedPending++;
        continue;
      }

      if(cleanupProtectStarred && row?.starred){
        protectedStarred++;
        continue;
      }

      if(userCardId)toDiscard.push(row);
    }

    cleanupState={
      status:'ready',
      commons,
      toDiscard,
      wishlistCount:wishlistIds.size,
      protectedWishlist,
      protectedPending,
      protectedStarred,
      pagesRead:collection.pagesRead,
      scanned:commons.length,
      done:0,
      failed:0,
      error:''
    };

    $('status').textContent=
      `Nettoyage prêt : ${toDiscard.length} carte(s) commune(s) défaussable(s).`;

    render();
  }catch(e){
    cleanupState={
      ...cleanupState,
      status:'error',
      error:e.message||String(e)
    };
    $('status').textContent='Nettoyage : '+cleanupState.error;
    render();
  }
}

async function discardCommonCleanup(){
  if(cleanupState.status!=='ready')return;

  const queue=[...cleanupState.toDiscard];
  if(!queue.length)return;

  const ok=confirm(
    `Défausser définitivement ${queue.length} carte(s) commune(s) hors wishlist ?\n\n`+
    'Les cartes protégées par wishlist, transaction et étoile ne seront pas touchées.'
  );
  if(!ok)return;

  const tabs=await marketplaceTabs('');
  const tabInfo=tabs.find(t=>!String(t.url||'').includes('#wikidex-sync'));
  if(!tabInfo){
    $('status').textContent='Garde au moins un onglet WikiMasters ouvert.';
    return;
  }

  cleanupState={
    ...cleanupState,
    status:'discard',
    done:0,
    failed:0,
    error:''
  };
  render();

  let consecutiveFailures=0;

  for(let i=0;i<queue.length;i++){
    const row=queue[i];

    cleanupState.done=i;
    $('status').textContent=
      `Défausse ${i+1}/${queue.length} · ${row?.card?.wikipedia_title||'Carte'}`;
    updateCleanupProgressDom();

    const r=await runWikiDiscardUserCard(tabInfo.id,row.id);

    if(r?.ok){
      consecutiveFailures=0;
      cleanupState.done=i+1;

      const balance=Number(r?.data?.balance);
      if(Number.isFinite(balance)){
        wikibidouBalance={
          amount:balance,
          status:'ok',
          updatedAt:Date.now(),
          error:''
        };

        await chrome.storage.local.set({
          [WIKIBIDOU_BALANCE_KEY]:{
            amount:balance,
            updatedAt:wikibidouBalance.updatedAt
          }
        }).catch(()=>{});
      }
    }else{
      cleanupState.failed++;
      consecutiveFailures++;

      // Never retry a destructive POST automatically.
      if(consecutiveFailures>=3){
        cleanupState.error=
          'Arrêt de sécurité après 3 échecs consécutifs. Aucun POST en échec n’a été retenté.';
        break;
      }
    }

    // Keep the batch deliberately sequential and gentle on the API.
    await new Promise(r=>setTimeout(r,250));
  }

  const completed=cleanupState.done;
  const failed=cleanupState.failed;

  $('status').textContent=cleanupState.error
    ? `Nettoyage interrompu · ${completed} réussie(s) · ${failed} échec(s)`
    : `Nettoyage terminé · ${completed} réussie(s) · ${failed} échec(s)`;

  // Re-read the server state instead of trusting the local queue after writes.
  await analyzeCommonCleanup();
}

function updateCleanupProgressDom(){
  const el=$('cleanupProgress');
  if(!el)return;

  const total=cleanupState.toDiscard.length||0;
  const done=Math.min(cleanupState.done||0,total);
  const pct=total?Math.round(done/total*100):0;

  el.innerHTML=
    `<div class="cleanupProgressText">${done}/${total} · ${pct}% · ${cleanupState.failed||0} échec(s)</div>`+
    `<div class="cleanupProgressTrack"><div class="cleanupProgressBar" style="width:${pct}%"></div></div>`;
}

async function runMarketplaceMainGet(tabId,listingId){
  const executed=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[listingId],
    func:async(id)=>{
      const url=`https://www.wiki-masters.com/api/marketplace/${id}`;
      const waits=[0,350,900];

      let last=null;
      for(const wait of waits){
        if(wait)await new Promise(r=>setTimeout(r,wait));
        try{
          const r=await fetch(url,{
            method:'GET',
            headers:{accept:'*/*'},
            credentials:'include',
            cache:'no-store'
          });

          const text=await r.text();
          let data=null;
          try{data=text?JSON.parse(text):null}catch{data=text}

          last={
            ok:r.ok,
            status:r.status,
            data,
            text,
            listingId:id,
            readAt:Date.now(),
            href:location.href,
            origin:location.origin
          };

          if(r.ok)return last;

          // Only retry transient-ish read failures.
          if(![404,500,502,503,504].includes(r.status))return last;
        }catch(e){
          last={
            ok:false,
            status:0,
            error:e?.message||String(e),
            listingId:id,
            href:location.href,
            origin:location.origin
          };
        }
      }
      return last;
    }
  });

  return executed?.[0]?.result||null;
}

async function runMarketplaceMainBid(tabId,listingId,amount){
  const executed=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[listingId,amount],
    func:async(id,bidAmount)=>{
      // IMPORTANT: one POST attempt only. Never retry a bid automatically.
      const url=`https://www.wiki-masters.com/api/marketplace/${id}/bid`;
      try{
        const r=await fetch(url,{
          method:'POST',
          headers:{
            accept:'*/*',
            'content-type':'application/json'
          },
          credentials:'include',
          cache:'no-store',
          body:JSON.stringify({amount:bidAmount})
        });

        const text=await r.text();
        let data=null;
        try{data=text?JSON.parse(text):null}catch{data=text}

        return {
          ok:r.ok,
          status:r.status,
          data,
          text,
          listingId:id,
          amount:bidAmount,
          href:location.href,
          origin:location.origin
        };
      }catch(e){
        return {
          ok:false,
          status:0,
          error:e?.message||String(e),
          listingId:id,
          amount:bidAmount,
          href:location.href,
          origin:location.origin
        };
      }
    }
  });

  return executed?.[0]?.result||null;
}

async function loadCols(){
  const r=await chrome.runtime.sendMessage({type:'COL_LIST'});
  cols=r.items||[];
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function pic(c){
  return c.image?`<div class="pic"><img src="${esc(c.image)}" loading="lazy"></div>`:
    `<div class="pic"><div class="noimg">Image non détectée</div></div>`;
}
function card(c,withCheck=false,remove=false){
  const sel=selected.has(c.id);
  return `<div class="card ${sel?'selected':''}" data-card="${c.id}">
    ${withCheck?`<input class="check" type="checkbox" data-check="${c.id}" ${sel?'checked':''}>`:''}
    ${pic(c)}
    <div class="p"><div class="title">${esc(c.title)}</div><div class="sub">${esc(c.subtitle||'')}</div>
    ${c.rarity?`<span class="badge">${esc(c.rarity)}</span>`:''}
    ${remove?`<button class="danger" data-remove="${c.id}" style="width:100%;margin-top:6px">Retirer</button>`:''}
    </div></div>`;
}

function selectedRarities(){
  const active=[...document.querySelectorAll('.rarityChip.active')].map(b=>b.dataset.rarity);
  return new Set(active);
}

function applyFilters(){
  // Rarity filtering is now server-side. rawResults already contains only
  // the rareties requested from WikiMasters.
  results=[...rawResults];
}

function setRarityFilter(values){
  const wanted=new Set(values);
  document.querySelectorAll('.rarityChip').forEach(b=>{
    b.classList.toggle('active',wanted.has(b.dataset.rarity));
  });
  persistUiState();
  if(($('q')?.value||'').trim()) search(true);
  else render();
}

function bindRarityFilters(){
  document.querySelectorAll('.rarityChip').forEach(b=>{
    b.onclick=async()=>{
      b.classList.toggle('active');

      // At least one rarity must remain selected.
      if(!document.querySelector('.rarityChip.active')){
        b.classList.add('active');
        return;
      }

      await persistUiState();

      if(($('q')?.value||'').trim()) search(true);
      else render();
    };
  });

  const all=$('rarityAll');
  if(all) all.onclick=()=>setRarityFilter(['L','UR','SR','R','PC','C']);

  const high=$('rarityHigh');
  if(high) high.onclick=()=>setRarityFilter(['L','UR','SR','R']);
}

const FRANCE_PRESET = `| 01 | Ain | Poulet de Bresse |
| 02 | Aisne | Chemin des Dames |
| 03 | Allier | Vichy |
| 04 | Alpes-de-Haute-Provence | Gorges du Verdon |
| 05 | Hautes-Alpes | Briançon |
| 06 | Alpes-Maritimes | Promenade des Anglais |
| 07 | Ardèche | Pont d'Arc |
| 08 | Ardennes | Place Ducale de Charleville-Mézières |
| 09 | Ariège | Château de Montségur |
| 10 | Aube | Troyes |
| 11 | Aude | Cité de Carcassonne 🔥 |
| 12 | Aveyron | Viaduc de Millau 🔥 |
| 13 | Bouches-du-Rhône | Notre-Dame-de-la-Garde |
| 14 | Calvados | Omaha Beach |
| 15 | Cantal | Puy Mary |
| 16 | Charente | Cognac |
| 17 | Charente-Maritime | Fort Boyard 🔥 |
| 18 | Cher | Cathédrale de Bourges |
| 19 | Corrèze | Collonges-la-Rouge |
| 2A | Corse-du-Sud | Bonifacio 🔥 |
| 2B | Haute-Corse | Cap Corse |
| 21 | Côte-d'Or | Hospices de Beaune |
| 22 | Côtes-d'Armor | Côte de granit rose |
| 23 | Creuse | Tapisserie d'Aubusson |
| 24 | Dordogne | Grotte de Lascaux 🔥 |
| 25 | Doubs | Citadelle de Besançon |
| 26 | Drôme | Palais idéal du facteur Cheval |
| 27 | Eure | Giverny |
| 28 | Eure-et-Loir | Cathédrale de Chartres |
| 29 | Finistère | Pointe du Raz |
| 30 | Gard | Pont du Gard 🔥 |
| 31 | Haute-Garonne | Place du Capitole |
| 32 | Gers | Armagnac |
| 33 | Gironde | Dune du Pilat 🔥 |
| 34 | Hérault | Place de la Comédie (Montpellier) |
| 35 | Ille-et-Vilaine | Saint-Malo |
| 36 | Indre | Château de Valençay |
| 37 | Indre-et-Loire | Château de Chenonceau 🔥 |
| 38 | Isère | Alpe d'Huez |
| 39 | Jura | Comté |
| 40 | Landes | Hossegor |
| 41 | Loir-et-Cher | Château de Chambord 🔥 |
| 42 | Loire | Stade Geoffroy-Guichard |
| 43 | Haute-Loire | Le Puy-en-Velay |
| 44 | Loire-Atlantique | Machines de l'île de Nantes |
| 45 | Loiret | Cathédrale Sainte-Croix d'Orléans |
| 46 | Lot | Rocamadour 🔥 |
| 47 | Lot-et-Garonne | Pruneau d'Agen |
| 48 | Lozère | Gorges du Tarn |
| 49 | Maine-et-Loire | Château d'Angers |
| 50 | Manche | Mont-Saint-Michel 👑 |
| 51 | Marne | Champagne 🍾 |
| 52 | Haute-Marne | Langres |
| 53 | Mayenne | Sainte-Suzanne (Mayenne) |
| 54 | Meurthe-et-Moselle | Place Stanislas 🔥 |
| 55 | Meuse | Bataille de Verdun |
| 56 | Morbihan | Alignements de Carnac |
| 57 | Moselle | Cathédrale Saint-Étienne de Metz |
| 58 | Nièvre | Circuit de Nevers Magny-Cours |
| 59 | Nord | Lille |
| 60 | Oise | Château de Chantilly |
| 61 | Orne | Camembert 🧀 |
| 62 | Pas-de-Calais | Cap Blanc-Nez |
| 63 | Puy-de-Dôme | Puy de Dôme 🔥 |
| 64 | Pyrénées-Atlantiques | Biarritz |
| 65 | Hautes-Pyrénées | Pic du Midi de Bigorre |
| 66 | Pyrénées-Orientales | Canigou |
| 67 | Bas-Rhin | Cathédrale Notre-Dame de Strasbourg 🔥 |
| 68 | Haut-Rhin | Colmar |
| 69 | Rhône | Basilique Notre-Dame de Fourvière |
| 70 | Haute-Saône | Chapelle Notre-Dame-du-Haut de Ronchamp |
| 71 | Saône-et-Loire | Roche de Solutré |
| 72 | Sarthe | 24 Heures du Mans 🔥 |
| 73 | Savoie | Courchevel |
| 74 | Haute-Savoie | Mont Blanc 👑 |
| 75 | Paris | Tour Eiffel 👑 |
| 76 | Seine-Maritime | Étretat 🔥 |
| 77 | Seine-et-Marne | Disneyland Paris 🔥 |
| 78 | Yvelines | Château de Versailles 👑 |
| 79 | Deux-Sèvres | Marais poitevin |
| 80 | Somme | Baie de Somme |
| 81 | Tarn | Cathédrale Sainte-Cécile d'Albi |
| 82 | Tarn-et-Garonne | Abbaye Saint-Pierre de Moissac |
| 83 | Var | Saint-Tropez |
| 84 | Vaucluse | Palais des papes d'Avignon 🔥 |
| 85 | Vendée | Puy du Fou |
| 86 | Vienne | Futuroscope |
| 87 | Haute-Vienne | Porcelaine de Limoges |
| 88 | Vosges | Image d'Épinal |
| 89 | Yonne | Basilique Sainte-Marie-Madeleine de Vézelay |
| 90 | Territoire de Belfort | Lion de Belfort |
| 91 | Essonne | Autodrome de Linas-Montlhéry |
| 92 | Hauts-de-Seine | Grande Arche de la Défense |
| 93 | Seine-Saint-Denis | Stade de France |
| 94 | Val-de-Marne | Marché international de Rungis |
| 95 | Val-d'Oise | Auvers-sur-Oise |
| 971 | Guadeloupe | La Soufrière 🌋 |
| 972 | Martinique | Montagne Pelée 🌋 |
| 973 | Guyane | Centre spatial guyanais 🚀 |
| 974 | La Réunion | Piton de la Fournaise 🌋 |
| 976 | Mayotte | Lagon de Mayotte |`;

function stripDecorations(s){
  return String(s||'')
    .replace(/\*\*/g,'')
    .replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function parseImportList(text){
  const out=[];
  for(const raw of String(text||'').split(/\r?\n/)){
    const line=raw.trim();
    if(!line)continue;
    if(/^\|\s*[-:]+\s*\|/.test(line))continue;
    if(/département/i.test(line) && /carte/i.test(line))continue;

    let parts=[];
    if(line.includes('|')){
      parts=line.split('|').map(x=>x.trim()).filter(Boolean);
    }else if(line.includes(';')){
      parts=line.split(';').map(x=>x.trim()).filter(Boolean);
    }else if(line.includes('\t')){
      parts=line.split('\t').map(x=>x.trim()).filter(Boolean);
    }

    let code='',department='',query='';

    if(parts.length>=3){
      code=stripDecorations(parts[0].replace(/^#\s*/,''));
      department=stripDecorations(parts[1]);
      query=stripDecorations(parts.slice(2).join(' | '));
    }else if(parts.length===2){
      department=stripDecorations(parts[0]);
      query=stripDecorations(parts[1]);
    }else{
      query=stripDecorations(line.replace(/^\d+[.)-]?\s*/,''));
    }

    if(!query || /^carte iconique/i.test(query))continue;
    out.push({code,department,query});
  }
  return out;
}

async function runPool(items,limit,worker,onProgress){
  let next=0,done=0;
  const results=new Array(items.length);

  async function runner(){
    while(true){
      const i=next++;
      if(i>=items.length)return;
      try{
        results[i]=await worker(items[i],i);
      }catch(e){
        results[i]={
          status:'missing',
          entry:items[i],
          error:e.message||String(e),
          candidates:[]
        };
      }
      done++;
      onProgress?.(done,items.length,results[i]);
    }
  }

  await Promise.all(Array.from({length:Math.min(limit,items.length)},runner));
  return results;
}

async function startBulkImport(){
  const entries=parseImportList($('importText').value);
  const name=($('importCollectionName').value||'Collection importée').trim();

  if(!entries.length){
    $('importProgress').textContent='Aucune ligne exploitable détectée.';
    return;
  }

  $('startImport').disabled=true;
  $('cancelImport').disabled=true;
  $('importReport').hidden=true;
  $('importProgress').textContent=`0 / ${entries.length} — démarrage…`;

  const resolved=await runPool(
    entries,
    3,
    entry=>chrome.runtime.sendMessage({type:'IMPORT_RESOLVE_ONE',entry}),
    (done,total,last)=>{
      const icon=last?.status==='matched'?'✅':last?.status==='ambiguous'?'⚠️':'❌';
      $('importProgress').textContent=
        `${done} / ${total} — ${icon} ${last?.entry?.department||''} · ${last?.entry?.query||''}`;
    }
  );

  const matched=resolved.filter(x=>x?.status==='matched' && x.card);
  const ambiguous=resolved.filter(x=>x?.status==='ambiguous');
  const missing=resolved.filter(x=>!x || x.status==='missing');

  const collection={
    id:uid(),
    name,
    cardIds:[...new Set(matched.map(x=>x.card.id))],
    createdAt:Date.now(),
    importReport:{
      createdAt:Date.now(),
      total:entries.length,
      matched:matched.length,
      ambiguous:ambiguous.length,
      missing:missing.length,
      rows:resolved.map(x=>({
        code:x?.entry?.code||'',
        department:x?.entry?.department||'',
        query:x?.entry?.query||'',
        status:x?.status||'missing',
        matchedTitle:x?.card?.title||'',
        matchedRarity:x?.card?.rarity||'',
        candidates:x?.candidates||[]
      }))
    }
  };

  await chrome.runtime.sendMessage({type:'COL_SAVE',collection});
  await loadCols();

  const report=[];
  report.push(`<div class="importOk"><b>✅ ${matched.length}</b> ajoutée(s) automatiquement</div>`);
  report.push(`<div class="importWarn"><b>⚠️ ${ambiguous.length}</b> ambiguë(s), non ajoutée(s)</div>`);
  report.push(`<div class="importMiss"><b>❌ ${missing.length}</b> introuvable(s)</div>`);

  if(ambiguous.length){
    report.push('<hr><b>À vérifier :</b>');
    for(const x of ambiguous){
      const cand=(x.candidates||[]).map(c=>`${esc(c.title)} [${esc(c.rarity||'?')}]`).join(' / ');
      report.push(`<div class="importWarn">${esc(x.entry.code)} ${esc(x.entry.department)} — ${esc(x.entry.query)} → ${cand||'aucun candidat'}</div>`);
    }
  }

  if(missing.length){
    report.push('<hr><b>Introuvables :</b>');
    for(const x of missing){
      report.push(`<div class="importMiss">${esc(x?.entry?.code||'')} ${esc(x?.entry?.department||'')} — ${esc(x?.entry?.query||'')}</div>`);
    }
  }

  $('importReport').innerHTML=report.join('');
  $('importReport').hidden=false;
  $('importProgress').textContent=
    `Terminé — collection "${name}" créée avec ${matched.length}/${entries.length} cartes.`;

  $('startImport').disabled=false;
  $('cancelImport').disabled=false;

  tab='collections';
  openCol=collection.id;
  await render();
}



function money(v){
  const n=Number(v);
  return Number.isFinite(n)?n.toFixed(2).replace('.',','):'—';
}
function auctionTitle(a){
  return a?.card?.wikipedia_title || a?.snapshot_search_document || a?.card?.category || 'Enchère';
}
function auctionClosed(a){
  const status=String(a?.status||'').toLowerCase();
  const closed=[
    'settled_sold','settled_unsold','sold','closed','expired',
    'cancelled','canceled','ended','settled'
  ];
  if(closed.includes(status))return true;
  const end=a?.end_at ? Date.parse(a.end_at) : NaN;
  return Number.isFinite(end) && end<=Date.now();
}
function roundMoney(n){
  return Math.round((Number(n)+Number.EPSILON)*100)/100;
}
function nextAutoBidAmount(base){
  const n=Number(base);
  if(!Number.isFinite(n)||n<0)return NaN;
  return Math.max(
    Math.ceil(n*(1+AUTOBID_INCREMENT_PCT/100)),
    Math.floor(n)+1
  );
}
function addAutoLog(item,msg){
  item.logs=Array.isArray(item.logs)?item.logs:[];
  item.logs.unshift(`${new Date().toLocaleTimeString('fr-FR')} — ${msg}`);
  item.logs=item.logs.slice(0,12);
}
async function saveAutoBids(){
  await chrome.storage.local.set({[AUTOBID_KEY]:autoBids});
}
async function loadAutoBids(){
  const x=await chrome.storage.local.get(AUTOBID_KEY);
  autoBids=Array.isArray(x?.[AUTOBID_KEY])?x[AUTOBID_KEY]:[];
}
function findAuto(id){
  return autoBids.find(x=>x.id===id);
}
async function inspectAuction(listing){
  const match=String(listing||'').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const listingId=match?.[0]||'';
  if(!listingId)throw new Error('ID d’enchère invalide.');

  const tabs=await marketplaceTabs(listingId);
  if(!tabs.length)throw new Error('Garde au moins un onglet WikiMasters ouvert.');

  const failures=[];

  for(const t of tabs){
    try{
      const page=await runMarketplaceMainGet(t.id,listingId);
      if(!page){
        failures.push(`${t.id}: aucune réponse`);
        continue;
      }

      if(page.ok){
        let userId=null;
        try{
          const u=await chrome.runtime.sendMessage({
            type:'SESSION_USER_ID',
            tabId:t.id
          });
          if(!u?.error)userId=u?.userId||null;
        }catch{}

        return {
          listingId:page.listingId,
          data:page.data,
          readAt:page.readAt,
          pageHref:page.href,
          pageOrigin:page.origin,
          sourceTabId:t.id,
          userId
        };
      }

      const body=typeof page.data==='string'
        ? page.data
        : JSON.stringify(page.data||{});
      failures.push(`${page.status||0} @ ${page.origin||t.url}: ${body.slice(0,90)}`);
    }catch(e){
      failures.push(`${t.id}: ${e.message||String(e)}`);
    }
  }

  throw new Error(`Lecture enchère impossible après ${tabs.length} onglet(s) : ${failures.slice(0,3).join(' | ')}`);
}
async function placeBid(listing,amount,preferredTabId=null){
  const match=String(listing||'').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const listingId=match?.[0]||'';
  if(!listingId)throw new Error('ID d’enchère invalide.');

  const n=Number(amount);
  if(!Number.isFinite(n)||n<=0)throw new Error('Montant d’enchère invalide.');

  let tabId=preferredTabId;

  if(tabId){
    try{
      const t=await chrome.tabs.get(tabId);
      if(!t?.url?.includes('wiki-masters.com'))tabId=null;
    }catch{
      tabId=null;
    }
  }

  if(!tabId){
    const tabs=await marketplaceTabs(listingId);
    if(!tabs.length)throw new Error('Garde au moins un onglet WikiMasters ouvert.');
    tabId=tabs[0].id;
  }

  const page=await runMarketplaceMainBid(tabId,listingId,n);
  if(!page)throw new Error('Aucune réponse du contexte WikiMasters.');
  if(page.error)throw new Error(page.error);

  if(!page.ok){
    const msg=typeof page.data==='string'
      ? page.data
      : (page.data?.error || page.data?.message || JSON.stringify(page.data||{}));
    throw new Error(`Enchère refusée (HTTP ${page.status})${msg?`: ${String(msg).slice(0,220)}`:''}`);
  }

  return {
    ok:true,
    status:page.status,
    data:page.data,
    listingId:page.listingId,
    amount:page.amount,
    pageHref:page.href,
    pageOrigin:page.origin,
    sourceTabId:tabId
  };
}

function listingPrice(a){
  const raw=[
    a?.effectiveBid,a?.effective_bid,
    a?.currentBid,a?.current_bid,
    a?.baseAmount,a?.base_amount,
    a?.listingBaseAmount,a?.listing_base_amount
  ].filter(v=>v!==null && v!==undefined && v!=='');

  const values=raw.map(Number).filter(Number.isFinite);
  return values.length?values[0]:Infinity;
}

function normalizeCardKey(value){
  const raw=String(value||'').trim().toLowerCase().replace(/^api_/,'');
  const uuid=raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid ? uuid[0].toLowerCase() : raw;
}

async function testMarketplaceCardFilter(tabId,cardId,listingId=''){
  const result=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[cardId,listingId],
    func:async(cardId,listingId)=>{
      const norm=v=>String(v||'').trim().toLowerCase();
      const candidates=['card_id','cardId'];

      for(const param of candidates){
        try{
          const url=new URL('https://www.wiki-masters.com/api/marketplace');
          url.searchParams.set('page','1');
          url.searchParams.set('limit','50');
          url.searchParams.set('sort','recent');
          url.searchParams.set(param,cardId);

          const controller=new AbortController();
          const timer=setTimeout(()=>controller.abort(),5000);
          let r;
          try{
            r=await fetch(url.toString(),{
              method:'GET',
              headers:{accept:'*/*'},
              credentials:'include',
              cache:'no-store',
              signal:controller.signal
            });
          }finally{
            clearTimeout(timer);
          }

          const text=await r.text();
          let data=null;
          try{data=text?JSON.parse(text):null}catch{}
          if(!r.ok)continue;

          const rows=Array.isArray(data?.auctions)?data.auctions:[];
          const ids=rows.map(a=>norm(a?.card_id||a?.card?.id)).filter(Boolean);
          const wanted=norm(cardId);
          const allMatch=ids.length>0 && ids.every(x=>x===wanted);
          const targetSeen=rows.some(a=>String(a?.id||'')===String(listingId||''));

          // Strong signal only: every returned auction belongs to the requested card.
          if(allMatch){
            return {supported:true,param,count:rows.length,targetSeen};
          }
        }catch{}
      }

      return {supported:false};
    }
  });

  return result?.[0]?.result||{supported:false};
}

async function testMarketplaceTextFilter(tabId,title,listingId=''){
  const result=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[title,listingId],
    func:async(title,listingId)=>{
      const candidates=['q','search','query'];

      for(const param of candidates){
        try{
          const url=new URL('https://www.wiki-masters.com/api/marketplace');
          url.searchParams.set('page','1');
          url.searchParams.set('limit','50');
          url.searchParams.set('sort','recent');
          url.searchParams.set(param,title);

          const controller=new AbortController();
          const timer=setTimeout(()=>controller.abort(),5000);
          let r;
          try{
            r=await fetch(url.toString(),{
              method:'GET',
              headers:{accept:'*/*'},
              credentials:'include',
              cache:'no-store',
              signal:controller.signal
            });
          }finally{
            clearTimeout(timer);
          }

          const text=await r.text();
          let data=null;
          try{data=text?JSON.parse(text):null}catch{}
          if(!r.ok)continue;

          const rows=Array.isArray(data?.auctions)?data.auctions:[];
          const targetSeen=rows.some(a=>String(a?.id||'')===String(listingId||''));

          if(targetSeen){
            return {supported:true,param,count:rows.length,targetSeen};
          }
        }catch{}
      }

      return {supported:false};
    }
  });

  return result?.[0]?.result||{supported:false};
}

async function fetchWishlistMarketplaceByTitle(tabId,wishlistCards,userId,param){
  const result=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[wishlistCards,userId,param],
    func:async(cards,currentUserId,param)=>{
      const normalize=v=>{
        const raw=String(v||'').trim().toLowerCase().replace(/^api_/,'');
        const m=raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        return m?m[0].toLowerCase():raw;
      };

      const matches=[];
      const seenListings=new Set();
      let requests=0;
      let failed=0;

      const emit=detail=>{
        try{
          window.postMessage({
            source:'wikidex',
            type:'WD_MARKET_SCAN_PROGRESS',
            detail:{...detail,at:Date.now()}
          },'*');
        }catch{}
      };

      for(let i=0;i<cards.length;i++){
        const card=cards[i]||{};
        const wanted=normalize(card.id);
        const title=String(card.title||'').trim();
        if(!wanted || !title)continue;

        emit({
          phase:'targetedTitle',
          current:i+1,
          total:cards.length,
          title,
          scanned:i,
          matches:matches.length
        });

        try{
          const url=new URL('https://www.wiki-masters.com/api/marketplace');
          url.searchParams.set('page','1');
          url.searchParams.set('limit','50');
          url.searchParams.set('sort','recent');
          url.searchParams.set(param,title);

          const controller=new AbortController();
          const timer=setTimeout(()=>controller.abort(),7000);
          let r;
          try{
            r=await fetch(url.toString(),{
              method:'GET',
              headers:{accept:'*/*'},
              credentials:'include',
              cache:'no-store',
              signal:controller.signal
            });
            requests++;

            const text=await r.text();
            let data=null;
            try{data=text?JSON.parse(text):null}catch{}
            if(!r.ok){failed++;continue;}

            const rows=Array.isArray(data?.auctions)?data.auctions:[];
            for(const a of rows){
              if(!a?.id || seenListings.has(a.id))continue;

              const marketId=normalize(a.card_id||a.card?.id);
              if(marketId!==wanted)continue;
              seenListings.add(a.id);

              if(String(a.status||'').toLowerCase()!=='active')continue;
              if(currentUserId && a.seller_id===currentUserId)continue;

              const end=a.end_at?Date.parse(a.end_at):NaN;
              if(Number.isFinite(end)&&end<=Date.now())continue;

              matches.push({
                listingId:a.id,
                id:a.id,
                cardId:a.card_id||a.card?.id,
                sellerId:a.seller_id,
                currentBid:a.current_bid,
                baseAmount:a.base_amount,
                effectiveBid:a.effective_bid,
                endAt:a.end_at,
                status:a.status,
                currentBidderId:a.current_bidder_id,
                title:a.card?.wikipedia_title||a.snapshot_search_document||a.card?.category||title,
                rarity:a.snapshot_rarity||a.card?.rarity||card.rarity||'',
                category:a.card?.category||'',
                imageUrl:a.card?.image_url||'',
                sellerName:a.seller?.username||'',
                owned:!!a.owned
              });
            }
          }finally{
            clearTimeout(timer);
          }
        }catch{
          failed++;
        }

        await new Promise(r=>setTimeout(r,40));
      }

      emit({
        phase:'done',
        scanned:cards.length,
        matches:matches.length,
        targetedTitle:true
      });

      return {
        ok:true,
        targetedTitle:true,
        requests,
        failed,
        scanned:cards.length,
        pagesRead:requests,
        matches,
        wishlistCount:cards.length,
        marketUniqueCards:null,
        truncated:false,
        finished:true
      };
    }
  });

  return result?.[0]?.result||null;
}

async function fetchWishlistMarketplaceTargeted(tabId,wishlistCardIds,userId,param){
  const result=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[wishlistCardIds,userId,param],
    func:async(wishedIds,currentUserId,param)=>{
      const normalize=v=>{
        const raw=String(v||'').trim().toLowerCase().replace(/^api_/,'');
        const m=raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        return m?m[0].toLowerCase():raw;
      };

      const matches=[];
      const seenListings=new Set();
      let requests=0;
      let failed=0;

      const emit=detail=>{
        try{
          window.postMessage({
            source:'wikidex',
            type:'WD_MARKET_SCAN_PROGRESS',
            detail:{...detail,at:Date.now()}
          },'*');
        }catch{}
      };

      for(let i=0;i<wishedIds.length;i++){
        const wanted=normalize(wishedIds[i]);
        if(!wanted)continue;

        emit({
          phase:'targeted',
          current:i+1,
          total:wishedIds.length,
          scanned:i,
          matches:matches.length
        });

        try{
          const url=new URL('https://www.wiki-masters.com/api/marketplace');
          url.searchParams.set('page','1');
          url.searchParams.set('limit','50');
          url.searchParams.set('sort','recent');
          url.searchParams.set(param,wanted);

          const r=await fetch(url.toString(),{
            method:'GET',
            headers:{accept:'*/*'},
            credentials:'include',
            cache:'no-store'
          });
          requests++;

          const text=await r.text();
          let data=null;
          try{data=text?JSON.parse(text):null}catch{}
          if(!r.ok){failed++;continue;}

          const rows=Array.isArray(data?.auctions)?data.auctions:[];
          for(const a of rows){
            if(!a?.id || seenListings.has(a.id))continue;

            const marketId=normalize(a.card_id||a.card?.id);
            if(marketId!==wanted)continue;
            seenListings.add(a.id);

            if(String(a.status||'').toLowerCase()!=='active')continue;
            if(currentUserId && a.seller_id===currentUserId)continue;

            const end=a.end_at?Date.parse(a.end_at):NaN;
            if(Number.isFinite(end)&&end<=Date.now())continue;

            matches.push({
              listingId:a.id,
              id:a.id,
              cardId:a.card_id||a.card?.id,
              sellerId:a.seller_id,
              currentBid:a.current_bid,
              baseAmount:a.base_amount,
              effectiveBid:a.effective_bid,
              endAt:a.end_at,
              status:a.status,
              currentBidderId:a.current_bidder_id,
              title:a.card?.wikipedia_title||a.snapshot_search_document||a.card?.category||'Carte',
              rarity:a.snapshot_rarity||a.card?.rarity||'',
              category:a.card?.category||'',
              imageUrl:a.card?.image_url||'',
              sellerName:a.seller?.username||'',
              owned:!!a.owned
            });
          }
        }catch{
          failed++;
        }

        await new Promise(r=>setTimeout(r,35));
      }

      emit({
        phase:'done',
        scanned:wishedIds.length,
        matches:matches.length,
        targeted:true
      });

      return {
        ok:true,
        targeted:true,
        requests,
        failed,
        scanned:wishedIds.length,
        pagesRead:requests,
        matches,
        wishlistCount:wishedIds.length,
        marketUniqueCards:null,
        truncated:false,
        finished:true
      };
    }
  });

  return result?.[0]?.result||null;
}

async function fetchWishlistMarketplaceApi(tabId,wishlistCardIds,userId){
  const result=await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    args:[wishlistCardIds,userId],
    func:async(wishedIds,currentUserId)=>{
      const normalizeCardKey=value=>{
        const raw=String(value||'').trim().toLowerCase().replace(/^api_/,'');
        const uuid=raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        return uuid ? uuid[0].toLowerCase() : raw;
      };

      const wished=new Set((wishedIds||[]).map(normalizeCardKey).filter(Boolean));
      const matches=[];
      const seenListings=new Set();
      const seenMarketCards=new Set();
      const failedSegments=[];

      const emit=detail=>{
        try{
          window.postMessage({
            source:'wikidex',
            type:'WD_MARKET_SCAN_PROGRESS',
            detail:{...detail,at:Date.now()}
          },'*');
        }catch{}
      };

      const MAIN_LIMIT=50;
      const MAX_MAIN_PAGES=250;

      function keepAuction(a){
        if(!a?.id || seenListings.has(a.id))return;
        seenListings.add(a.id);

        const marketCardId=normalizeCardKey(a.card_id || a.card?.id);
        if(marketCardId)seenMarketCards.add(marketCardId);
        if(!marketCardId || !wished.has(marketCardId))return;
        if(String(a.status||'').toLowerCase()!=='active')return;
        if(currentUserId && a.seller_id===currentUserId)return;

        const end=a.end_at?Date.parse(a.end_at):NaN;
        if(Number.isFinite(end) && end<=Date.now())return;

        matches.push({
          listingId:a.id,
          id:a.id,
          cardId:a.card_id || a.card?.id,
          sellerId:a.seller_id,
          currentBid:a.current_bid,
          baseAmount:a.base_amount,
          effectiveBid:a.effective_bid,
          endAt:a.end_at,
          status:a.status,
          currentBidderId:a.current_bidder_id,
          title:a.card?.wikipedia_title || a.snapshot_search_document || a.card?.category || 'Carte',
          rarity:a.snapshot_rarity || a.card?.rarity || '',
          category:a.card?.category || '',
          imageUrl:a.card?.image_url || '',
          sellerName:a.seller?.username || '',
          owned:!!a.owned
        });
      }

      async function requestPage(page,limit){
        const url=`https://www.wiki-masters.com/api/marketplace?page=${page}&limit=${limit}&sort=recent`;
        const retryDelays=[0,500,1400,3000];
        let last=null;

        for(let attempt=0;attempt<retryDelays.length;attempt++){
          const delay=retryDelays[attempt];

          emit({
            phase:attempt===0?'request':'retry',
            page,
            limit,
            attempt:attempt+1,
            attempts:retryDelays.length,
            status:last?.status||null
          });

          if(delay)await new Promise(r=>setTimeout(r,delay));

          try{
            const response=await fetch(url,{
              method:'GET',
              headers:{accept:'*/*'},
              credentials:'include',
              cache:'no-store'
            });

            const text=await response.text();
            let data=null;
            try{data=text?JSON.parse(text):null}catch{}

            last={
              ok:response.ok,
              status:response.status,
              text,
              data,
              page,
              limit
            };

            if(response.ok)return last;

            // Retry only transient/server-side failures.
            if(![429,500,502,503,504].includes(response.status)){
              return last;
            }
          }catch(e){
            last={
              ok:false,
              status:0,
              text:e?.message||String(e),
              data:null,
              page,
              limit
            };
          }
        }

        return last;
      }

      // Fetch an exact logical range by offset. If a large page persistently
      // returns 5xx, split the same range into smaller API pages.
      async function fetchSegment(offset,size){
        if(offset % size !== 0){
          return {ok:false,rows:[],hasMore:true,error:`Offset ${offset} incompatible avec limit ${size}`};
        }

        const page=(offset/size)+1;
        const r=await requestPage(page,size);

        if(r?.ok){
          const rows=Array.isArray(r.data?.auctions)?r.data.auctions:[];
          return {
            ok:true,
            rows,
            hasMore:!!r.data?.hasMore,
            page:Number(r.data?.page||page),
            limit:Number(r.data?.limit||size)
          };
        }

        // Split 50 -> 25+25, then 25 -> 5+5+5+5+5.
        let childSize=null;
        if(size===50)childSize=25;
        else if(size===25)childSize=5;

        if(childSize){
          emit({
            phase:'split',
            offset,
            size,
            childSize,
            page:(offset/size)+1
          });

          const parts=[];
          let aggregateHasMore=true;

          for(let childOffset=offset;childOffset<offset+size;childOffset+=childSize){
            const sub=await fetchSegment(childOffset,childSize);
            parts.push(...(sub.rows||[]));
            aggregateHasMore=sub.hasMore;
          }

          return {
            ok:true,
            rows:parts,
            hasMore:aggregateHasMore,
            recovered:true
          };
        }

        // At limit=5, don't abort the entire market scan.
        // Record the missing five-auction slice and continue.
        failedSegments.push({
          offset,
          size,
          status:r?.status||0,
          error:(r?.text||'Erreur inconnue').slice(0,160)
        });

        emit({
          phase:'skip',
          offset,
          size,
          status:r?.status||0,
          failedSegments:failedSegments.length
        });

        return {
          ok:true,
          rows:[],
          hasMore:true,
          skipped:true
        };
      }

      let scanned=0;
      let pagesRead=0;
      let recoveredPages=0;
      let offset=0;
      let finished=false;

      for(let mainIndex=0;mainIndex<MAX_MAIN_PAGES;mainIndex++){
        const segment=await fetchSegment(offset,MAIN_LIMIT);
        pagesRead++;

        if(segment.recovered)recoveredPages++;

        const rows=Array.isArray(segment.rows)?segment.rows:[];
        scanned+=rows.length;
        for(const a of rows)keepAuction(a);

        emit({
          phase:'progress',
          block:mainIndex+1,
          pagesRead,
          scanned,
          matches:matches.length,
          recoveredPages,
          failedSegments:failedSegments.length
        });

        // If the complete 50-auction range was successfully read and the API
        // says there is no next range, the market scan is complete.
        if(segment.hasMore===false){
          finished=true;
          break;
        }

        // A short successful page is also a natural end-of-list signal.
        // Do not use it when recovery had missing limit=5 slices.
        if(!segment.recovered && !segment.skipped && rows.length<MAIN_LIMIT){
          finished=true;
          break;
        }

        offset+=MAIN_LIMIT;
        await new Promise(r=>setTimeout(r,50));
      }

      emit({
        phase:'done',
        pagesRead,
        scanned,
        matches:matches.length,
        recoveredPages,
        failedSegments:failedSegments.length,
        finished
      });

      return {
        ok:true,
        scanned,
        pagesRead,
        matches,
        wishlistCount:wished.size,
        marketUniqueCards:seenMarketCards.size,
        wishlistSample:[...wished].slice(0,3),
        marketSample:[...seenMarketCards].slice(0,3),
        recoveredPages,
        failedSegments,
        skippedAuctionsMax:failedSegments.reduce((n,x)=>n+(x.size||0),0),
        truncated:!finished,
        finished
      };
    }
  });

  return result?.[0]?.result||null;
}

function chooseOneListingPerCard(rows,userId){
  const now=Date.now();
  const byCard=new Map();

  for(const a of rows){
    if(!a?.cardId)continue;
    if(String(a.status||'').toLowerCase()!=='active')continue;
    const end=a.endAt?Date.parse(a.endAt):NaN;
    if(Number.isFinite(end) && end<=now)continue;
    if(userId && a.sellerId===userId)continue;

    const old=byCard.get(a.cardId);
    if(!old){
      byCard.set(a.cardId,{...a,alternatives:1});
      continue;
    }

    const ap=listingPrice(a);
    const op=listingPrice(old);
    const ae=Number.isFinite(end)?end:Infinity;
    const oe=old.endAt?Date.parse(old.endAt):Infinity;

    old.alternatives=(old.alternatives||1)+1;

    if(ap<op || (ap===op && ae<oe)){
      const alternatives=old.alternatives;
      byCard.set(a.cardId,{...a,alternatives});
    }
  }

  return [...byCard.values()].sort((a,b)=>{
    const ea=a.endAt?Date.parse(a.endAt):Infinity;
    const eb=b.endAt?Date.parse(b.endAt):Infinity;
    return ea-eb || listingPrice(a)-listingPrice(b);
  });
}

function marketProgressText(info=marketScanInfo){
  const elapsed=info.startedAt?Math.max(0,Math.round((Date.now()-info.startedAt)/1000)):0;
  const p=info.progress||{};

  if(p.phase==='retry'){
    return `Page ${p.page} × ${p.limit} — retry ${p.attempt}/${p.attempts}${p.status?` · HTTP ${p.status}`:''}`;
  }
  if(p.phase==='split'){
    return `Page ${p.page} en erreur — découpage ${p.size} → ${p.childSize}`;
  }
  if(p.phase==='skip'){
    return `Segment de ${p.size} enchère(s) illisible — scan poursuivi`;
  }
  if(p.phase==='request'){
    return `Lecture page ${p.page} × ${p.limit}… · ${elapsed}s`;
  }
  if(p.phase==='targeted'){
    return `Recherche wishlist ${p.current}/${p.total} · ${p.matches||0} enchère(s) trouvée(s) · ${elapsed}s`;
  }
  if(p.phase==='targetedTitle'){
    return `Recherche ${p.current}/${p.total} · ${p.matches||0} enchère(s) trouvée(s) · ${elapsed}s · ${p.title||''}`;
  }
  if(p.phase==='wishlist'){
    return `Lecture de la wishlist… · ${elapsed}s`;
  }
  if(p.phase==='probe'){
    return `Lecture de l’enchère témoin… · ${elapsed}s`;
  }
  if(p.phase==='testCardFilter'){
    return `Test du filtre card_id… · ${elapsed}s`;
  }
  const block=p.block||info.pagesRead||0;
  const scanned=p.scanned??info.scannedListings??0;
  const matches=p.matches??info.wishlistMatches??0;
  return `Bloc ${block} · ${scanned} enchère(s) lue(s) · ${matches} correspondance(s) · ${elapsed}s`;
}

function setMarketProgress(detail){
  marketScanInfo.progress={...(detail||{}),at:Date.now()};
  updateMarketProgressDom();
}

function updateMarketProgressDom(){
  if(marketScanInfo.status!=='scan')return;
  const textEl=$('marketProgressText');
  const metaEl=$('marketProgressMeta');
  if(textEl)textEl.textContent=marketProgressText();
  if(metaEl){
    const p=marketScanInfo.progress||{};
    metaEl.textContent=`Tranches : ${p.pagesRead||marketScanInfo.pagesRead||0} · récupérées par découpage : ${p.recoveredPages||0} · segments ignorés : ${p.failedSegments||0}`;
  }
}

async function scanWishlistMarketplace(){
  marketScanInfo={status:'scan',scannedListings:0,wishlistMatches:0,sourceUrl:'',startedAt:Date.now(),progress:{phase:'start'}};
  marketSuggestions=[];
  if(tab==='autobid')render();

  try{
    const tabs=await marketplaceTabs('');
    if(!tabs.length){
      throw new Error('Garde au moins un onglet WikiMasters ouvert.');
    }

    const tabId=tabs[0].id;

    setMarketProgress({phase:'wishlist'});
    const wishlist=await chrome.runtime.sendMessage({
      type:'WISHLIST_GET_ALL',
      tabId
    });
    if(wishlist?.error)throw new Error(wishlist.error);

    const wished=Array.isArray(wishlist.cardIds)?wishlist.cardIds:[];
    if(!wished.length){
      throw new Error('Ta wishlist WikiMasters est vide.');
    }

    const wishedSet=new Set(wished.map(normalizeCardKey).filter(Boolean));
    let openListingProbe=null;

    const detailTab=tabs.find(t=>/\/marketplace\/[0-9a-f-]{36}(?:[/?#]|$)/i.test(String(t.url||'')));
    if(detailTab){
      setMarketProgress({phase:'probe'});
      const idMatch=String(detailTab.url||'').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if(idMatch){
        try{
          const detail=await runMarketplaceMainGet(detailTab.id,idMatch[0]);
          const auction=detail?.data?.auction;
          if(detail?.ok && auction){
            const marketCardId=normalizeCardKey(auction.card_id || auction.card?.id);
            openListingProbe={
              title:auction.card?.wikipedia_title || auction.snapshot_search_document || 'Enchère ouverte',
              listingId:auction.id || idMatch[0],
              marketCardId,
              rawCardId:auction.card_id || auction.card?.id || '',
              inWishlist:wishedSet.has(marketCardId)
            };
          }
        }catch(e){
          openListingProbe={error:e.message||String(e)};
        }
      }
    }

    const wishlistCards=Array.isArray(wishlist.cards)?wishlist.cards:[];

    // q= has already been validated against a real open auction.
    // Do not waste time re-probing q/search/query on every scan.
    let scan=null;

    if(wishlistCards.length){
      setMarketProgress({
        phase:'targetedTitle',
        current:0,
        total:wishlistCards.length,
        title:'démarrage',
        matches:0
      });

      scan=await fetchWishlistMarketplaceByTitle(
        tabId,
        wishlistCards,
        wishlist.userId||null,
        'q'
      );

      if(scan){
        scan.textFilter={supported:true,param:'q',cached:true};
      }
    }else{
      // Fallback only if wishlist titles could not be resolved.
      scan=await fetchWishlistMarketplaceApi(
        tabId,
        wished,
        wishlist.userId||null
      );
    }

    if(scan){
      scan.cardFilter=null;
      scan.cardsLookupError=wishlist.cardsLookupError||'';
      scan.wishlistTitles=wishlistCards.length;
    }

    if(!scan)throw new Error('Aucune réponse du scanner marché.');
    if(!scan.ok)throw new Error(scan.error||'Erreur pendant le scan du marché.');

    marketSuggestions=chooseOneListingPerCard(
      scan.matches||[],
      wishlist.userId
    );

    marketScanInfo={
      status:'done',
      scannedListings:scan.scanned||0,
      pagesRead:scan.pagesRead||0,
      wishlistMatches:(scan.matches||[]).length,
      uniqueCards:marketSuggestions.length,
      wishlistCount:scan.wishlistCount||wished.length,
      marketUniqueCards:scan.marketUniqueCards||0,
      wishlistSample:Array.isArray(scan.wishlistSample)?scan.wishlistSample:[],
      marketSample:Array.isArray(scan.marketSample)?scan.marketSample:[],
      openListingProbe,
      truncated:!!scan.truncated,
      recoveredPages:scan.recoveredPages||0,
      failedSegments:Array.isArray(scan.failedSegments)?scan.failedSegments:[],
      skippedAuctionsMax:scan.skippedAuctionsMax||0,
      targeted:!!scan.targeted,
      targetedTitle:!!scan.targetedTitle,
      cardFilter:scan.cardFilter||null,
      textFilter:scan.textFilter||null,
      wishlistTitles:scan.wishlistTitles||0,
      cardsLookupError:scan.cardsLookupError||'',
      requests:scan.requests||0,
      failedRequests:scan.failed||0,
      sourceUrl:'API /api/marketplace'
    };

    $('status').textContent=
      `${marketSuggestions.length} carte(s) de ta wishlist trouvée(s) sur ${scan.scanned||0} enchère(s).`;

    await persistUiState();
    if(tab==='autobid')render();
  }catch(e){
    marketScanInfo={...marketScanInfo,status:'error',error:e.message||String(e)};
    $('status').textContent='Scan marché : '+(e.message||String(e));
    if(tab==='autobid')render();
  }
}

async function addSuggestionAutoBid(listingId){
  const row=marketSuggestions.find(x=>x.listingId===listingId);
  if(!row)return;

  const maxEl=document.querySelector(`[data-suggest-max="${listingId}"]`);
  const max=Number(maxEl?.value);

  if(!Number.isFinite(max)||max<=0){
    $('status').textContent='Définis un plafond pour cette suggestion.';
    maxEl?.focus();
    return;
  }

  await createAutoBid({
    listing:`https://www.wiki-masters.com/marketplace/${listingId}`,
    max:String(max)
  });

  // Remove suggestion once it has become an auto-bid.
  if(autoBids.some(x=>x.listingId===listingId)){
    marketSuggestions=marketSuggestions.filter(x=>x.listingId!==listingId);
    delete suggestionDrafts[listingId];
    await persistUiState();
  }
  render();
}

async function waitWikiMastersSyncTab(tabId,timeout=15000){
  const current=await chrome.tabs.get(tabId).catch(()=>null);
  if(current?.status==='complete')return;

  await new Promise((resolve,reject)=>{
    let done=false;

    const cleanup=()=>{
      if(done)return;
      done=true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
    };

    const onUpdated=(id,info)=>{
      if(id!==tabId || info.status!=='complete')return;
      cleanup();
      resolve();
    };

    const timer=setTimeout(()=>{
      cleanup();
      reject(new Error('Chargement de WikiMasters trop long.'));
    },timeout);

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function syncMyBidsFromWikiMasters(){
  const btn=$('syncMyBids');
  if(btn)btn.disabled=true;
  $('status').textContent='Synchronisation de Marché → Mes enchères…';

  let tempTab=null;

  try{
    tempTab=await chrome.tabs.create({
      url:'https://www.wiki-masters.com/marketplace#wikidex-sync',
      active:false
    });

    await waitWikiMastersSyncTab(tempTab.id);
    await new Promise(r=>setTimeout(r,500));

    const found=await chrome.tabs.sendMessage(tempTab.id,{
      type:'WD_DISCOVER_MY_BIDS'
    });

    if(found?.error)throw new Error(found.error);

    const listingIds=[...new Set(
      (Array.isArray(found?.ids)?found.ids:[])
        .map(x=>String(x||'').toLowerCase())
        .filter(Boolean)
    )];

    if(!listingIds.length){
      throw new Error(
        found?.tabFound
          ? 'Aucune enchère active détectée dans « Mes enchères ».'
          : 'L’onglet « Mes enchères » n’a pas été détecté sur la page Marché.'
      );
    }

    let userId=null;
    try{
      const u=await chrome.runtime.sendMessage({
        type:'SESSION_USER_ID',
        tabId:tempTab.id
      });
      if(!u?.error)userId=u?.userId||null;
    }catch{}

    let added=0;
    let updated=0;
    let failed=0;

    for(let i=0;i<listingIds.length;i++){
      const listingId=listingIds[i];
      $('status').textContent=`Synchronisation ${i+1}/${listingIds.length}…`;

      try{
        const page=await runMarketplaceMainGet(tempTab.id,listingId);
        const a=page?.data?.auction;
        if(!page?.ok || !a){
          failed++;
          continue;
        }

        const existing=autoBids.find(x=>x.listingId===listingId);
        const currentBid=Number(a.current_bid ?? a.base_amount ?? 0);
        const currentBidderId=a.current_bidder_id||null;
        const closed=auctionClosed(a);

        if(existing){
          existing.title=auctionTitle(a);
          existing.currentBid=currentBid;
          existing.currentBidderId=currentBidderId;
          existing.userId=userId||existing.userId||null;
          existing.status=a.status||'';
          existing.endAt=a.end_at||null;
          existing.lastSuccessAt=Date.now();
          existing.lastError='';
          existing.consecutiveErrors=0;

          if(existing.mode==='track'){
            existing.enabled=!closed;
            existing.wasHighest=!!(
              existing.userId &&
              currentBidderId===existing.userId
            );
            existing.lastAction=closed
              ? 'Synchronisée — enchère terminée'
              : 'Synchronisée depuis WikiMasters — suivi actif';
          }

          addAutoLog(existing,'Synchronisée depuis WikiMasters');
          updated++;
          continue;
        }

        const item={
          id:crypto.randomUUID(),
          listingId,
          mode:'track',
          enabled:!closed,
          max:null,
          logs:[],
          title:auctionTitle(a),
          currentBid,
          currentBidderId,
          userId:userId||null,
          status:a.status||'',
          endAt:a.end_at||null,
          sourceTabId:null,
          lastAttemptKey:null,
          lastAttemptAt:0,
          lastSuccessAt:Date.now(),
          consecutiveErrors:0,
          nextPollAt:0,
          lastError:'',
          wasHighest:!!(
            userId &&
            currentBidderId===userId
          ),
          lastAction:closed
            ? 'Synchronisée — enchère terminée'
            : 'Synchronisée depuis WikiMasters — suivi uniquement'
        };

        addAutoLog(item,'Importée depuis « Mes enchères » en mode suivi');
        autoBids.push(item);
        added++;
      }catch{
        failed++;
      }
    }

    await saveAutoBids();
    await persistUiState();
    chrome.runtime.sendMessage({type:'AUTOBID_WAKE'}).catch(()=>{});

    $('status').textContent=
      `Synchronisation terminée · +${added} nouvelle(s) · ${updated} déjà connue(s) · ${failed} échec(s)`;

    await render();
  }catch(e){
    $('status').textContent='Synchronisation impossible : '+(e.message||String(e));
  }finally{
    if(tempTab?.id)chrome.tabs.remove(tempTab.id).catch(()=>{});
    if(btn)btn.disabled=false;
  }
}

async function configureTrackedAutoBid(id){
  const item=findAuto(id);
  if(!item)return;

  autoDraft={
    listing:`https://www.wiki-masters.com/marketplace/${item.listingId}`,
    max:''
  };

  await persistUiState();

  if($('autoListing'))$('autoListing').value=autoDraft.listing;
  if($('autoMax'))$('autoMax').value='';

  $('status').textContent=`Définis le plafond AutoBid pour ${item.title||'cette enchère'}.`;
  $('autoMax')?.focus();
}
async function createAutoBid(input=null){
  const hasExplicitInput=
    input &&
    typeof input==='object' &&
    typeof input.listing==='string';

  if(hasExplicitInput){
    autoDraft={
      listing:input.listing||'',
      max:String(input.max??'')
    };
  }else{
    autoDraft={
      listing:$('autoListing')?.value||'',
      max:$('autoMax')?.value||''
    };
  }

  const listing=autoDraft.listing.trim();
  const max=Number(autoDraft.max);

  if(!listing){$('status').textContent='Colle une URL ou un ID d’enchère.';return}
  if(!Number.isFinite(max)||max<=0){$('status').textContent='Plafond invalide.';return}

  $('status').textContent='Lecture de l’enchère…';

  try{
    const r=await inspectAuction(listing);
    const a=r.data?.auction;
    if(!a)throw new Error('Enchère introuvable.');

    const existing=autoBids.find(x=>x.listingId===r.listingId);
    const item=existing||{
      id:crypto.randomUUID(),
      listingId:r.listingId,
      enabled:true,
      logs:[]
    };

    item.mode='autobid';
    item.max=roundMoney(max);
    item.incrementPct=AUTOBID_INCREMENT_PCT;
    delete item.step;
    item.enabled=!auctionClosed(a);
    item.title=auctionTitle(a);
    item.currentBid=Number(a.current_bid ?? a.base_amount ?? 0);
    item.currentBidderId=a.current_bidder_id||null;
    item.userId=r.userId||item.userId||null;
    item.status=a.status||'';
    item.endAt=a.end_at||null;
    item.sourceTabId=r.sourceTabId||null;
    item.lastAttemptKey=null;
    item.lastAttemptAt=0;
    const hadErrors=(item.consecutiveErrors||0)>0 || !!item.lastError;
    item.lastSuccessAt=Date.now();
    item.consecutiveErrors=0;
    item.nextPollAt=0;
    item.lastError='';
    if(hadErrors)addAutoLog(item,'Lecture rétablie');
    item.lastAction=item.enabled?'Surveillance activée':'Enchère déjà terminée';
    addAutoLog(item,existing?'Paramètres mis à jour':'Auto-enchère créée');

    if(!existing)autoBids.push(item);
    await saveAutoBids();
    chrome.runtime.sendMessage({type:'AUTOBID_WAKE'}).catch(()=>{});
    autoDraft={listing:'',max:''};
    await persistUiState();
    $('status').textContent=`Auto-enchère ${item.enabled?'activée':'créée mais inactive'} : ${item.title}`;
    render();
  }catch(e){
    $('status').textContent='Impossible d’ajouter l’auto-enchère : '+e.message;
  }
}

async function processAutoBid(item){
  if(!item.enabled)return;

  const now=Date.now();
  if(item.nextPollAt && now<item.nextPollAt)return;

  let r;
  try{
    r=await inspectAuction(item.listingId);
    item.lastSuccessAt=Date.now();
    item.consecutiveErrors=0;
    item.nextPollAt=0;
    item.lastError='';
  }catch(e){
    item.consecutiveErrors=(item.consecutiveErrors||0)+1;
    item.lastError=e.message||String(e);

    // Back off progressively after repeated failures.
    const delay=Math.min(30000, 5000*Math.pow(2,Math.min(3,item.consecutiveErrors-1)));
    item.nextPollAt=Date.now()+delay;
    item.lastAction=`Lecture indisponible — nouvel essai dans ${Math.round(delay/1000)} s`;

    // Avoid flooding the log with an identical 404 every cycle.
    const sig=`${item.consecutiveErrors}|${item.lastError}`;
    if(item._lastErrorSig!==sig || item.consecutiveErrors<=2){
      addAutoLog(item,'Lecture impossible : '+item.lastError);
      item._lastErrorSig=sig;
    }
    return;
  }

  const a=r.data?.auction;
  if(!a){
    item.lastAction='Réponse invalide';
    return;
  }

  item.userId=r.userId||item.userId||null;
  item.title=auctionTitle(a);
  item.currentBid=Number(a.current_bid ?? a.base_amount ?? 0);
  item.currentBidderId=a.current_bidder_id||null;
  item.status=a.status||'';
  item.endAt=a.end_at||null;
  item.sourceTabId=r.sourceTabId||item.sourceTabId||null;

  if(auctionClosed(a)){
    item.enabled=false;
    const won=item.userId && (
      a.winner_id===item.userId ||
      a.current_bidder_id===item.userId
    );
    item.lastAction=won?'Terminée — gagnée':'Terminée';
    addAutoLog(item,item.lastAction+(a.final_price!=null?` à ${money(a.final_price)}`:''));
    return;
  }

  if(!item.userId){
    item.lastAction='Session utilisateur introuvable';
    return;
  }

  if(a.seller_id===item.userId){
    item.enabled=false;
    item.lastAction='Arrêt — tu es le vendeur';
    addAutoLog(item,item.lastAction);
    return;
  }

  if(a.current_bidder_id===item.userId){
    item.lastAction=`En tête à ${money(item.currentBid)}`;
    return;
  }

  const base=Number(a.current_bid ?? a.base_amount ?? 0);
  const next=nextAutoBidAmount(base);

  if(next>Number(item.max)+1e-9){
    item.enabled=false;
    item.lastAction=`Plafond atteint (${money(item.max)})`;
    addAutoLog(item,`Pas de surenchère : +10 % ⇒ ${money(next)} > plafond ${money(item.max)}`);
    return;
  }

  // Never repeat the same automatic POST in a tight loop.
  const attemptKey=`${a.current_bidder_id||'none'}|${base}|${next}`;
  const attemptNow=Date.now();
  if(item.lastAttemptKey===attemptKey && attemptNow-(item.lastAttemptAt||0)<8000){
    item.lastAction='Attente confirmation serveur';
    return;
  }

  // Avoid firing literally at/after the known end instant.
  const end=a.end_at ? Date.parse(a.end_at) : NaN;
  if(Number.isFinite(end) && end-Date.now()<500){
    item.lastAction='Fin imminente — aucun POST';
    return;
  }

  item.lastAttemptKey=attemptKey;
  item.lastAttemptAt=attemptNow;
  item.lastAction=`Surenchère ${money(next)} en cours…`;
  await saveAutoBids();

  try{
    await placeBid(item.listingId,next,item.sourceTabId||null);
    item.lastAction=`Surenchère envoyée : ${money(next)}`;
    addAutoLog(item,`POST /bid → ${money(next)}`);
  }catch(e){
    item.lastAction='Enchère refusée';
    addAutoLog(item,'POST refusé : '+e.message);
  }
}

async function tickAutoBids(){
  if(autoTickRunning)return;
  autoTickRunning=true;
  try{
    for(const item of autoBids){
      if(item.enabled)await processAutoBid(item);
    }
    await saveAutoBids();

    // Never rebuild the Auto-bid form while the user is typing in it.
    // Re-rendering replaces the <input> elements and would erase the draft.
    if(tab==='autobid'){
      const active=document.activeElement;
      const editing=!!active?.closest?.('.autoForm');
      if(!editing)render();
    }
  }finally{
    autoTickRunning=false;
  }
}
function ensureAutoTimer(){
  if(autoTimer)return;
  autoTimer=setInterval(async()=>{
    const active=document.activeElement;
    const editing=!!active?.closest?.('.autoForm,.marketSuggestionForm');
    if(editing)return;

    const x=await chrome.storage.local.get(AUTOBID_KEY).catch(()=>({}));
    const fresh=Array.isArray(x?.[AUTOBID_KEY])?x[AUTOBID_KEY]:[];
    autoBids=fresh;

    if(tab==='autobid')render();
  },2500);
}
async function toggleAutoBid(id){
  const item=findAuto(id);if(!item)return;
  item.enabled=!item.enabled;
  item.lastAction=item.enabled?'Surveillance activée':'Pause manuelle';
  addAutoLog(item,item.lastAction);
  await saveAutoBids();
  if(item.enabled){
    chrome.runtime.sendMessage({type:'AUTOBID_WAKE'}).catch(()=>{});
  }
  render();
}
async function deleteAutoBid(id){
  autoBids=autoBids.filter(x=>x.id!==id);
  await saveAutoBids();
  render();
}
async function refreshAutoBid(id){
  const item=findAuto(id);if(!item)return;
  item.nextPollAt=0;
  item.lastError='';
  await saveAutoBids();

  const r=await chrome.runtime.sendMessage({
    type:'AUTOBID_PROCESS_ONE',
    id
  }).catch(e=>({error:e?.message||String(e)}));

  if(r?.error)$('status').textContent='Actualisation auto-enchère : '+r.error;
  await loadAutoBids();
  render();
}
function autoState(item){
  if(!item.enabled)return {cls:'stop',txt:'OFF'};

  const age=item.lastSuccessAt ? Date.now()-item.lastSuccessAt : Infinity;
  if(item.lastError || age>15000){
    return {cls:'stop',txt:'LECTURE HS'};
  }

  if(item.mode==='track'){
    if(item.userId && item.currentBidderId===item.userId){
      return {cls:'on',txt:'SUIVI · EN TÊTE'};
    }
    return {cls:'wait',txt:'SUIVI'};
  }

  if(item.userId && item.currentBidderId===item.userId){
    return {cls:'on',txt:'EN TÊTE'};
  }

  return {cls:'wait',txt:'SURVEILLE'};
}

function autoEndMs(item){
  const t=item?.endAt?Date.parse(item.endAt):NaN;
  return Number.isFinite(t)?t:Infinity;
}

function autoPriceValue(item){
  const n=Number(item?.currentBid);
  return Number.isFinite(n)?n:Infinity;
}

function autoMaxValue(item){
  const n=Number(item?.max);
  return Number.isFinite(n)?n:Infinity;
}

function autoPriorityGroup(item){
  if(item?.enabled && item?.mode==='track'){
    return {key:'track',label:'Suivi',rank:0};
  }
  if(item?.enabled && item?.mode!=='track'){
    return {key:'autobid',label:'AutoBid actives',rank:1};
  }
  return {key:'inactive',label:'En pause / terminées',rank:2};
}

function autoAttentionRank(item){
  if(item?.lastError)return 0;
  if(
    item?.enabled &&
    item?.mode==='track' &&
    item?.userId &&
    item?.currentBidderId!==item.userId
  )return 1;
  return 2;
}

function compareAutoBids(a,b){
  const byEnd=()=>autoEndMs(a)-autoEndMs(b);
  const byTitle=()=>String(a?.title||'').localeCompare(
    String(b?.title||''),
    'fr'
  );

  if(autoSort==='priority'){
    const ga=autoPriorityGroup(a);
    const gb=autoPriorityGroup(b);
    if(ga.rank!==gb.rank)return ga.rank-gb.rank;

    const attention=autoAttentionRank(a)-autoAttentionRank(b);
    if(attention)return attention;

    return byEnd()||byTitle();
  }

  if(autoSort==='end')return byEnd()||byTitle();
  if(autoSort==='priceAsc'){
    return autoPriceValue(a)-autoPriceValue(b)||byEnd()||byTitle();
  }
  if(autoSort==='priceDesc'){
    return autoPriceValue(b)-autoPriceValue(a)||byEnd()||byTitle();
  }
  if(autoSort==='maxAsc'){
    return autoMaxValue(a)-autoMaxValue(b)||byEnd()||byTitle();
  }

  if(autoSort==='track'){
    const am=a?.mode==='track'?0:1;
    const bm=b?.mode==='track'?0:1;
    return am-bm||byEnd()||byTitle();
  }

  if(autoSort==='autobid'){
    const am=a?.mode==='track'?1:0;
    const bm=b?.mode==='track'?1:0;
    return am-bm||byEnd()||byTitle();
  }

  return byEnd()||byTitle();
}

async function render(){
  await loadCols();
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));

  if(tab==='results'){
    const controls=results.length?`
      <div class="toolbar">
        <button id="selectAll">Tout sélectionner</button>
        <button id="clearSel">Tout désélectionner</button>
        <span id="selCount">${selected.size} sélectionnée(s)</span>
        <span class="spacer"></span>
        <button id="addSelected" class="primary">＋ Ajouter à une collection</button>
      </div>`:'';
    const pager=results.length?`
      <div class="toolbar">
        <button id="more" ${pageInfo&&!pageInfo.hasNext?'disabled':''}>＋ Charger la page suivante</button>
        <span class="muted">${rawResults.length} chargée(s)</span>
        <span class="spacer"></span>
        ${pageInfo?.totalItems!=null?`<span class="muted">${pageInfo.totalItems} résultat(s) API</span>`:''}
        <button id="debug">API</button>
      </div>`:'';

    $('body').innerHTML=results.length?
      controls+`<div class="grid">${results.map(c=>card(c,true,false)).join('')}</div>`+pager:
      `<div class="empty">Recherche directement dans le catalogue WikiMasters.</div>`;

    bindChecks();
    if($('selectAll'))$('selectAll').onclick=async()=>{results.forEach(c=>selected.add(c.id));await persistUiState();render()};
    if($('clearSel'))$('clearSel').onclick=async()=>{results.forEach(c=>selected.delete(c.id));await persistUiState();render()};
    if($('addSelected'))$('addSelected').onclick=openAdd;
    if($('more'))$('more').onclick=async()=>{
      if(!pageInfo||pageInfo.hasNext){
        page++;
        await persistUiState();
        search(false);
      }
    };
    if($('debug'))$('debug').onclick=showDebug;
  }

  if(tab==='library'){
    const r=await chrome.runtime.sendMessage({type:'DB_QUERY',q:'',limit:300});
    $('body').innerHTML=`<div class="muted" style="margin-bottom:8px">${r.total} carte(s) mises en cache</div>
      <div class="grid">${(r.items||[]).map(c=>card(c,true,false)).join('')}</div>`;
    bindChecks();
  }


  if(tab==='autobid'){
    autoEngineStatus=await chrome.runtime.sendMessage({
      type:'AUTOBID_STATUS'
    }).catch(()=>({
      active:false,
      enabledCount:autoBids.filter(x=>x.enabled).length,
      lastTickAt:0,
      reason:'unavailable'
    }));

    const engineLabel=autoEngineStatus.active
      ? 'ACTIF'
      : autoEngineStatus.reason==='no-wikimasters-tab'
        ? 'EN ATTENTE — ouvre WikiMasters'
        : autoEngineStatus.enabledCount
          ? 'EN ATTENTE'
          : 'AUCUNE AUTO-ENCHÈRE ACTIVE';

    const engineAge=autoEngineStatus.lastTickAt
      ? Math.max(0,Math.round((Date.now()-autoEngineStatus.lastTickAt)/1000))
      : null;

    const sortedAutoBids=[...autoBids].sort(compareAutoBids);
    let lastPriorityGroup='';
    const rows=sortedAutoBids.map(item=>{
      const st=autoState(item);
      const end=item.endAt ? new Date(item.endAt).toLocaleString('fr-FR') : '—';
      const logs=(item.logs||[]).map(esc).join('\n');
      const group=autoSort==='priority'?autoPriorityGroup(item):null;
      const groupHead=
        group && group.key!==lastPriorityGroup
          ? `<div class="autoGroupTitle">${esc(group.label)}<span>${sortedAutoBids.filter(x=>autoPriorityGroup(x).key===group.key).length}</span></div>`
          : '';
      if(group)lastPriorityGroup=group.key;

      return groupHead+`<div class="autoRow">
        <div class="autoTop">
          <div class="autoTitle"><a class="auctionLink" href="https://www.wiki-masters.com/marketplace/${encodeURIComponent(item.listingId)}" target="_blank" rel="noopener noreferrer">${esc(item.title||item.listingId)}</a></div>
          <span class="autoState ${st.cls}">${st.txt}</span>
        </div>
        <div class="autoMeta">
          Actuelle : <b>${money(item.currentBid)}</b> · Plafond : <b>${item.mode==='track'?'— (suivi seul)':money(item.max)}</b> · Majoration : <b>${item.mode==='track'?'—':'+10 % arrondi au-dessus'}</b><br>
          Statut serveur : ${esc(item.status||'—')} · Fin : ${esc(end)}<br>
          ${item.lastSuccessAt?`Dernière lecture valide : ${esc(new Date(item.lastSuccessAt).toLocaleTimeString('fr-FR'))}<br>`:''}
          ${esc(item.lastAction||'En attente')}
        </div>
        <div class="autoBtns">
          <button data-auto-toggle="${item.id}">${item.enabled?(item.mode==='track'?'Pause suivi':'Pause'):(item.mode==='track'?'Reprendre suivi':'Activer')}</button>
          ${item.mode==='track'?`<button class="primary" data-auto-configure="${item.id}">Configurer AutoBid</button>`:''}
          <button data-auto-refresh="${item.id}">Actualiser</button>
          <button class="danger" data-auto-delete="${item.id}">Supprimer</button>
        </div>
        ${logs?`<div class="autoLog">${logs}</div>`:''}
      </div>`;
    }).join('');

    $('body').innerHTML=`
      <div class="wikiWallet">
        <div>
          <div class="wikiWalletLabel">Solde disponible</div>
          <div class="wikiWalletAmount"><span id="wikibidouAmount">${formatWikiBidous(wikibidouBalance.amount)}</span> Wikibidous</div>
          <div id="wikibidouMeta" class="wikiWalletMeta">${wikibidouBalance.updatedAt?'Mis à jour à '+esc(new Date(wikibidouBalance.updatedAt).toLocaleTimeString('fr-FR')):'Solde WikiMasters'}</div>
        </div>
        <button id="refreshWikiBidous">Actualiser</button>
      </div>

      <div class="autoForm">
        <input id="autoListing" class="wide" placeholder="URL ou ID de l’enchère" value="${esc(autoDraft.listing||'')}">
        <input id="autoMax" type="number" min="0.01" step="0.01" placeholder="Plafond" value="${esc(autoDraft.max||'')}">
        <button id="autoAdd" class="primary">Ajouter</button>
      </div>
      <div class="autoEngineStatus">
        <b>Moteur arrière-plan : ${esc(engineLabel)}</b>
        ${engineAge!==null?` · dernier tick il y a ${engineAge}s`:''}<br>
        Surveillance ~2,5 s tant qu’au moins un onglet WikiMasters reste ouvert.
        Le popup et le panneau peuvent être fermés.<br>
        Notifications : perte de tête · enchère gagnée · plafond atteint · solde ≤ 100 Wikibidous.
      </div>

      <div class="autoSyncBar">
        <button id="syncMyBids" class="primary">↻ Synchroniser</button>
        <span>Mes enchères WikiMasters · import en suivi uniquement</span>
      </div>

      <div class="autoListHead">
        <b>Mes enchères (${autoBids.length})</b>
        <div class="autoSortBar">
          <button class="autoSortBtn ${autoSort==='priority'?'active':''}" data-auto-sort="priority">Priorité</button>
          <button class="autoSortBtn ${autoSort==='end'?'active':''}" data-auto-sort="end">Fin bientôt</button>
          <button class="autoSortBtn ${autoSort==='priceAsc'?'active':''}" data-auto-sort="priceAsc">Prix ↑</button>
          <button class="autoSortBtn ${autoSort==='priceDesc'?'active':''}" data-auto-sort="priceDesc">Prix ↓</button>
          <button class="autoSortBtn ${autoSort==='maxAsc'?'active':''}" data-auto-sort="maxAsc">Plafond ↑</button>
          <button class="autoSortBtn ${autoSort==='track'?'active':''}" data-auto-sort="track">Suivi d’abord</button>
          <button class="autoSortBtn ${autoSort==='autobid'?'active':''}" data-auto-sort="autobid">AutoBid d’abord</button>
        </div>
      </div>

      ${rows||'<div class="empty">Aucune auto-enchère configurée.</div>'}

      <div class="marketScanBar">
        <b style="flex:1">Suggestions de la wishlist</b>
        <button id="scanMarket" class="primary">Scanner le marché</button>
      </div>
      ${marketScanInfo.status==='scan'
        ? `<div class="marketProgress">
            <div id="marketProgressText" class="marketProgressText">${esc(marketProgressText())}</div>
            <div class="marketProgressTrack"><div class="marketProgressBar"></div></div>
            <div id="marketProgressMeta" class="marketProgressMeta">Le total n’est pas fourni par l’API : progression par blocs lus.</div>
          </div>`
        : marketScanInfo.status==='error'
          ? `<div class="importMiss">${esc(marketScanInfo.error||'Erreur de scan')}</div>`
          : marketScanInfo.status==='done'
            ? `<div class="muted" style="margin-bottom:7px">
                ${marketScanInfo.targetedTitle || marketScanInfo.targeted
                  ? `${marketScanInfo.wishlistCount||marketScanInfo.scannedListings||0} carte(s) recherchée(s) · ${marketScanInfo.wishlistMatches||0} enchère(s) trouvée(s) · ${marketSuggestions.length} carte(s) unique(s)`
                  : `${marketScanInfo.scannedListings||0} enchère(s) lue(s) sur ${marketScanInfo.pagesRead||0} tranche(s) · ${marketScanInfo.wishlistMatches||0} correspondance(s) · ${marketSuggestions.length} carte(s) unique(s)`}
                ${marketScanInfo.recoveredPages?` · ${marketScanInfo.recoveredPages} page(s) récupérée(s) par découpage`:''}
                ${marketScanInfo.skippedAuctionsMax?` · jusqu’à ${marketScanInfo.skippedAuctionsMax} enchère(s) non lisible(s)`:''}
                ${marketScanInfo.truncated?' · LIMITE DE SCAN ATTEINTE':''}
                <div class="marketDiag">
                  Wishlist lue : <b>${marketScanInfo.wishlistCount||0}</b> carte(s)
                  ${marketScanInfo.targeted
                    ? ` · mode ciblé par card_id · ${marketScanInfo.requests||0} requête(s)`
                    : marketScanInfo.targetedTitle
                      ? ` · mode ciblé par titre (${esc(marketScanInfo.textFilter?.param||'q')}) · ${marketScanInfo.requests||0} requête(s)`
                      : ` · Marché : <b>${marketScanInfo.marketUniqueCards||0}</b> card_id unique(s)`}
                </div>
                ${marketScanInfo.cardsLookupError
                  ? `<div class="marketDiag warn">Titres wishlist non récupérés : ${esc(marketScanInfo.cardsLookupError)}</div>`
                  : marketScanInfo.wishlistTitles
                    ? `<div class="marketDiag">Titres wishlist récupérés : <b>${marketScanInfo.wishlistTitles}</b></div>`
                    : ''}
                ${marketScanInfo.openListingProbe?.marketCardId
                  ? `<div class="marketProbe ${marketScanInfo.openListingProbe.inWishlist?'ok':'bad'}">
                      Enchère ouverte : <b>${esc(marketScanInfo.openListingProbe.title)}</b><br>
                      card_id : <code>${esc(marketScanInfo.openListingProbe.marketCardId)}</code><br>
                      → ${marketScanInfo.openListingProbe.inWishlist
                        ? '<b>PRÉSENTE dans les IDs de la wishlist</b>'
                        : '<b>ABSENTE des IDs de la wishlist</b>'}
                    </div>`
                  : ''}
                ${marketScanInfo.wishlistMatches===0?'<div class="marketDiag warn">Aucune intersection d’identifiants détectée. Les UUID sont normalisés avant comparaison.</div>':''}
              </div>`
            : '<div class="muted">Lance un scan : WikiDex parcourt directement l’API du marché. Aucune page Marché n’a besoin d’être chargée.</div>'}

      ${marketSuggestions.map(s=>{
        const followed=autoBids.some(x=>x.listingId===s.listingId);
        const price=listingPrice(s);
        const end=s.endAt?new Date(s.endAt).toLocaleString('fr-FR'):'—';
        return `<div class="marketSuggestion">
          <div class="marketSuggestionTop">
            <div class="marketSuggestionTitle"><a class="auctionLink" href="https://www.wiki-masters.com/marketplace/${encodeURIComponent(s.listingId)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></div>
            <span class="marketBadge">${esc(s.rarity||'?')}</span>
          </div>
          <div class="marketSuggestionMeta">
            Prix actuel : <b>${money(price)}</b> · Fin : ${esc(end)}<br>
            Vendeur : ${esc(s.sellerName||'—')}
            ${s.alternatives>1?` · ${s.alternatives} offres pour cette carte, la moins chère est affichée`:''}
          </div>
          ${followed
            ? '<div class="marketSuggestionNote">Déjà présente dans tes auto-enchères.</div>'
            : `<div class="marketSuggestionForm">
                <input data-suggest-max="${s.listingId}" type="number" min="0.01" step="0.01" placeholder="Plafond" value="${esc(suggestionDrafts[s.listingId]?.max||'')}">
                <button class="green" data-suggest-add="${s.listingId}">Créer auto-enchère</button>
              </div>`}
        </div>`;
      }).join('')}
    `;

    $('autoAdd').onclick=createAutoBid;
    $('syncMyBids').onclick=syncMyBidsFromWikiMasters;
    document.querySelectorAll('[data-auto-sort]').forEach(b=>{
      b.onclick=async()=>{
        autoSort=b.dataset.autoSort||'priority';
        await persistUiState();
        render();
      };
    });
    $('refreshWikiBidous').onclick=()=>refreshWikiBidouBalance();
    updateWikiBidouBalanceDom();
    $('scanMarket').onclick=scanWishlistMarketplace;
    document.querySelectorAll('[data-suggest-add]').forEach(b=>b.onclick=()=>addSuggestionAutoBid(b.dataset.suggestAdd));

    const scheduleLocalSave=()=>{
      clearTimeout(window._wdLocalSave);
      window._wdLocalSave=setTimeout(()=>persistUiState(),180);
    };

    const rememberAutoDraft=()=>{
      autoDraft={
        listing:$('autoListing')?.value||'',
        max:$('autoMax')?.value||''
      };
      scheduleLocalSave();
    };
    $('autoListing').oninput=rememberAutoDraft;
    $('autoMax').oninput=rememberAutoDraft;

    document.querySelectorAll('[data-suggest-max]').forEach(el=>{
      el.oninput=()=>{
        const listingId=el.dataset.suggestMax;
        if(!listingId)return;
        suggestionDrafts[listingId]={
          max:el.value||''
        };
        scheduleLocalSave();
      };
    });

    document.querySelectorAll('[data-auto-toggle]').forEach(b=>b.onclick=()=>toggleAutoBid(b.dataset.autoToggle));
    document.querySelectorAll('[data-auto-configure]').forEach(b=>b.onclick=()=>configureTrackedAutoBid(b.dataset.autoConfigure));
    document.querySelectorAll('[data-auto-refresh]').forEach(b=>b.onclick=()=>refreshAutoBid(b.dataset.autoRefresh));
    document.querySelectorAll('[data-auto-delete]').forEach(b=>b.onclick=()=>deleteAutoBid(b.dataset.autoDelete));
  }

  if(tab==='collections'){
    if(openCol){
      const col=cols.find(c=>c.id===openCol);
      if(!col){openCol=null;return render()}
      const r=await chrome.runtime.sendMessage({type:'DB_GET_CARDS',ids:col.cardIds||[]});
      const ir=col.importReport;
      const importSummary=ir?`<div class="muted" style="margin-bottom:8px">Import : ✅ ${ir.matched}/${ir.total} · ⚠️ ${ir.ambiguous} · ❌ ${ir.missing}</div>`:'';
      $('body').innerHTML=`
        <div class="toolbar"><button id="back">←</button><b>${esc(col.name)} (${(col.cardIds||[]).length})</b><span class="spacer"></span><button id="export" class="primary">♥ Exporter</button></div>
        ${importSummary}
        <div class="grid">${(r.items||[]).map(c=>card(c,false,true)).join('')}</div>`;
      $('back').onclick=()=>{openCol=null;render()};
      $('export').onclick=()=>exportCol(col.id);
      document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>removeCard(col.id,b.dataset.remove));
    }else{
      $('body').innerHTML=`
        <div class="toolbar"><input id="colNew" class="grow" placeholder="Nouvelle collection…"><button id="colCreate">Créer</button><button id="openImport" class="primary">⇩ Importer une liste</button></div>
        ${cols.length?cols.map(c=>`<div class="colRow"><div class="name" data-open="${c.id}">📁 ${esc(c.name)}</div><span class="muted">${(c.cardIds||[]).length}</span><button class="primary" data-export="${c.id}">♥</button><button class="danger" data-del="${c.id}">×</button></div>`).join(''):'<div class="empty">Aucune collection.</div>'}`;
      $('colCreate').onclick=()=>createCollection($('colNew').value);
      $('openImport').onclick=()=>{$('importReport').hidden=true;$('importProgress').textContent='';$('importDlg').showModal()};
      document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{openCol=b.dataset.open;render()});
      document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportCol(b.dataset.export));
      document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteCol(b.dataset.del));
    }
  }
}
function bindChecks(){
  document.querySelectorAll('[data-check]').forEach(ch=>ch.onchange=async()=>{
    if(ch.checked)selected.add(ch.dataset.check);else selected.delete(ch.dataset.check);
    const box=ch.closest('.card');box?.classList.toggle('selected',ch.checked);
    const sc=$('selCount');if(sc)sc.textContent=`${selected.size} sélectionnée(s)`;
    await persistUiState();
  });
}
async function search(reset=true){
  const q=$('q').value.trim();
  if(!q)return;

  const rarities=[...document.querySelectorAll('.rarityChip.active')]
    .map(b=>b.dataset.rarity);

  if(!rarities.length){
    $('status').textContent='Sélectionne au moins une rareté.';
    return;
  }

  if(reset){
    page=0;
    currentQuery=q;
    rawResults=[];
    selected.clear();
  }

  $('status').textContent=
    `Recherche ${rarities.join(' + ')}… page ${page+1}`;

  try{
    const r=await chrome.runtime.sendMessage({
      type:'API_SEARCH_RARITIES',
      q:currentQuery||q,
      rarities,
      page
    });
    if(r?.error)throw new Error(r.error);

    const incoming=r.cards||[];

    // Merge page N with already loaded pages.
    const map=new Map(rawResults.map(c=>[c.id,c]));
    for(const c of incoming)map.set(c.id,c);
    rawResults=[...map.values()];

    // The service worker already ranked each incoming page. Re-rank the union
    // so exact titles stay first after "load more".
    const nq=(currentQuery||q).normalize('NFD')
      .replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
    const rr={'L':6,'UR':5,'SR':4,'R':3,'PC':2,'C':1};

    function n(s){
      return String(s||'').normalize('NFD')
        .replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
    }

    function score(c){
      const t=n(c.title),s=n(c.subtitle);
      let bucket=0;
      if(t===nq)bucket=6;
      else if(t.startsWith(nq+' ')||t.startsWith(nq+'(')||t.startsWith(nq+' -'))bucket=5;
      else if(t.includes(nq))bucket=4;
      else if(s.includes(nq))bucket=2;

      return bucket*100000 +
        (rr[String(c.rarity||'').toUpperCase()]||0)*100 -
        Math.min(1000,Math.abs(t.length-nq.length)*3);
    }

    rawResults.sort((a,b)=>score(b)-score(a));

    pageInfo=r.pageInfo||null;
    lastDebug=r.debug||null;
    applyFilters();
    tab='results';

    $('status').textContent=
      `${results.length} carte(s) chargée(s) · page API ${page+1}`+
      ` · filtres ${rarities.join(' + ')}`;

    await persistUiState();
    render();
  }catch(e){
    $('status').textContent='Erreur API : '+e.message;
  }
}
async function createCollection(name){
  name=(name||'').trim();if(!name)return null;
  const c={id:uid(),name,cardIds:[],createdAt:Date.now()};
  await chrome.runtime.sendMessage({type:'COL_SAVE',collection:c});
  await loadCols();render();return c;
}
async function openAdd(){
  if(!selected.size){$('status').textContent='Sélectionne au moins une carte.';return}
  await loadCols();
  $('choices').innerHTML=cols.length?cols.map(c=>`<button class="choice" data-choice="${c.id}">${esc(c.name)} (${(c.cardIds||[]).length})</button>`).join(''):'<div class="muted">Aucune collection.</div>';
  document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>addSelected(b.dataset.choice));
  $('newName').value='';$('addDlg').showModal();
}
async function addSelected(cid){
  const c=cols.find(x=>x.id===cid);if(!c)return;
  c.cardIds=[...new Set([...(c.cardIds||[]),...selected])];
  await chrome.runtime.sendMessage({type:'COL_SAVE',collection:c});
  $('status').textContent=`${selected.size} carte(s) ajoutée(s) à "${c.name}".`;
  selected.clear();$('addDlg').close();render();
}
async function removeCard(cid,id){
  const c=cols.find(x=>x.id===cid);if(!c)return;
  c.cardIds=(c.cardIds||[]).filter(x=>x!==id);
  await chrome.runtime.sendMessage({type:'COL_SAVE',collection:c});render();
}
async function deleteCol(id){
  const c=cols.find(x=>x.id===id);if(!c||!confirm(`Supprimer "${c.name}" ?`))return;
  await chrome.runtime.sendMessage({type:'COL_DELETE',id});render();
}
async function ensureContentScript(tabId){
  try{
    await chrome.tabs.sendMessage(tabId,{type:'WD_PING'});
    return;
  }catch{}
  await chrome.scripting.insertCSS({target:{tabId},files:['content.css']}).catch(()=>{});
  await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
}
async function exportCol(id){
  const t=await wikiTab();
  if(!t){
    $('status').textContent='Ouvre WikiMasters dans un onglet et connecte-toi avant l’export.';
    return;
  }

  $('status').textContent='Export wishlist via API…';

  try{
    const r=await chrome.runtime.sendMessage({
      type:'WISHLIST_EXPORT_API',
      id,
      tabId:t.id
    });

    if(r?.error)throw new Error(r.error);

    $('status').textContent=
      `Wishlist synchronisée · +${r.added||0} ajoutée(s)`+
      ` · ${r.already||0} déjà présente(s)`+
      ` · ${r.failed||0} échec(s)`;
  }catch(e){
    $('status').textContent='Export API impossible : '+e.message;
  }
}
function showDebug(){
  $('debugText').textContent=
    `${lastDebug?.requestUrl?`Requête :\n${lastDebug.requestUrl}\n\n`:''}`+
    `Clés racine : ${(lastDebug?.topLevel||[]).join(', ')}\n\nÉchantillon :\n${lastDebug?.rawSample||'aucun'}`;
  $('debugDlg').showModal();
}

$('go').onclick=()=>search(true);
$('q').onkeydown=e=>{if(e.key==='Enter')search(true)};
$('q').oninput=()=>{clearTimeout(window._wdPersistQ);window._wdPersistQ=setTimeout(persistUiState,200)};
document.querySelectorAll('.tab').forEach(b=>b.onclick=async()=>{
  tab=b.dataset.tab;
  openCol=null;
  await persistUiState();
  await render();

  if(tab==='autobid'){
    const stale=!wikibidouBalance.updatedAt || Date.now()-wikibidouBalance.updatedAt>60000;
    if(stale)refreshWikiBidouBalance({silent:true});
  }
});
$('closeDlg').onclick=()=>$('addDlg').close();

$('loadFrancePreset').onclick=()=>{
  $('importText').value=FRANCE_PRESET;
  $('importCollectionName').value='Pokédex France';
  $('importProgress').textContent='101 départements chargés dans l’importeur.';
};
$('startImport').onclick=startBulkImport;
$('cancelImport').onclick=()=>$('importDlg').close();

$('debugClose').onclick=()=>$('debugDlg').close();
$('create').onclick=async()=>{
  const c=await createCollection($('newName').value);
  if(c){await loadCols();await addSelected(c.id)}
};


$('openSide').onclick=async()=>{
  try{
    const w=await chrome.windows.getCurrent();
    await chrome.sidePanel.open({windowId:w.id});
    // In popup context, close the transient popup after opening the persistent panel.
    if(location.protocol==='chrome-extension:' && window.innerWidth<800){
      setTimeout(()=>window.close(),100);
    }
  }catch(e){
    $('status').textContent='Panneau latéral indisponible : '+e.message;
  }
};
bindRarityFilters();

chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(!changes[AUTOBID_KEY])return;

  autoBids=Array.isArray(changes[AUTOBID_KEY].newValue)
    ? changes[AUTOBID_KEY].newValue
    : [];

  if(tab==='autobid'){
    const active=document.activeElement;
    const editing=!!active?.closest?.('.autoForm,.marketSuggestionForm');
    if(!editing)render();
  }
});

chrome.runtime.onMessage.addListener(m=>{
  if(m.type==='WD_MARKET_SCAN_PROGRESS' && marketScanInfo.status==='scan'){
    const p=m.detail||{};
    marketScanInfo.progress=p;
    if(Number.isFinite(p.scanned))marketScanInfo.scannedListings=p.scanned;
    if(Number.isFinite(p.matches))marketScanInfo.wishlistMatches=p.matches;
    if(Number.isFinite(p.pagesRead))marketScanInfo.pagesRead=p.pagesRead;
    updateMarketProgressDom();
  }

  if(m.type==='WD_API_EXPORT_PROGRESS'){
    $('status').textContent=
      `Export API · +${m.added||0} · déjà ${m.already||0} · échecs ${m.failed||0} / ${m.total||0}`;
  }

  if(m.type==='WD_EXPORT_PROGRESS')$('status').textContent=`Export ${m.i}/${m.total} · +${m.added} · déjà ${m.already} · échecs ${m.failed}`;
  if(m.type==='WD_EXPORT_DONE')$('status').textContent=`Terminé · +${m.added} · déjà ${m.already} · échecs ${m.failed}`;
  if(m.type==='WD_ERROR')$('status').textContent='Erreur : '+m.error;
});
(async()=>{
  await loadAutoBids();
  await restoreWikiBidouBalance();
  ensureAutoTimer();
  await restoreUiState();
  await render();
  chrome.runtime.sendMessage({type:'AUTOBID_WAKE'}).catch(()=>{});
  if(tab==='autobid')refreshWikiBidouBalance({silent:true});
})();
