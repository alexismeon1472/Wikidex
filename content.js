
const WD={stop:false,exporting:false};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=s=>(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
  .replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)};

function first(obj,keys){
  for(const k of keys){
    if(obj && obj[k]!==undefined && obj[k]!==null && obj[k]!=='') return obj[k];
  }
  return null;
}
function stringVal(v){
  if(typeof v==='string') return v;
  if(v && typeof v==='object'){
    return first(v,['name','title','label','value','code']) ?? '';
  }
  return v==null?'':String(v);
}
function looksImageUrl(s){
  if(typeof s!=='string')return false;
  return /^https?:\/\//i.test(s) && (
    /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(s) ||
    /image|img|thumb|media|upload|wikimedia/i.test(s)
  );
}
function findImage(obj,depth=0,seen=new Set()){
  if(depth>4||obj==null)return '';
  if(typeof obj==='string') return looksImageUrl(obj)?obj:'';
  if(typeof obj!=='object'||seen.has(obj))return '';
  seen.add(obj);

  const preferred=['imageUrl','image_url','image','thumbnailUrl','thumbnail_url','thumbnail','picture','photo','illustration','cover','src','url'];
  for(const k of preferred){
    if(obj[k]){
      const r=findImage(obj[k],depth+1,seen);
      if(r)return r;
    }
  }
  for(const [k,v] of Object.entries(obj)){
    if(/image|img|thumb|photo|picture|cover|media/i.test(k)){
      const r=findImage(v,depth+1,seen);
      if(r)return r;
    }
  }
  for(const v of Object.values(obj)){
    const r=findImage(v,depth+1,seen);
    if(r)return r;
  }
  return '';
}
function candidateArrayScore(arr){
  if(!Array.isArray(arr)||!arr.length)return -1;
  const sample=arr.slice(0,5).filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
  if(!sample.length)return -1;
  let score=sample.length*2;
  const keyRe=/(title|name|card|article|rarity|image|slug|description|subtitle|wiki|id)/i;
  for(const o of sample){
    score+=Object.keys(o).filter(k=>keyRe.test(k)).length*2;
    if(first(o,['title','name','articleTitle','wikiTitle','cardTitle']))score+=8;
    if(first(o,['id','cardId','uuid','slug']))score+=4;
  }
  return score;
}
function findBestArray(root){
  let best=null,bestScore=-1;
  const seen=new Set();
  function walk(v,depth=0){
    if(depth>5||v==null||typeof v!=='object'||seen.has(v))return;
    seen.add(v);
    if(Array.isArray(v)){
      const s=candidateArrayScore(v);
      if(s>bestScore){bestScore=s;best=v}
      for(const x of v.slice(0,3))walk(x,depth+1);
    }else{
      for(const [k,x] of Object.entries(v)){
        if(['cards','items','results','data','rows','content'].includes(k)&&Array.isArray(x)){
          const s=candidateArrayScore(x)+10;
          if(s>bestScore){bestScore=s;best=x}
        }
        walk(x,depth+1);
      }
    }
  }
  walk(root);
  return best||[];
}
function getDeepNumber(root,keys){
  const seen=new Set();
  function walk(v,depth=0){
    if(depth>5||v==null||typeof v!=='object'||seen.has(v))return null;
    seen.add(v);
    for(const k of keys){
      if(typeof v[k]==='number'&&Number.isFinite(v[k]))return v[k];
    }
    for(const x of Object.values(v)){
      const r=walk(x,depth+1);if(r!==null)return r;
    }
    return null;
  }
  return walk(root);
}
function getDeepBool(root,keys){
  const seen=new Set();
  function walk(v,depth=0){
    if(depth>5||v==null||typeof v!=='object'||seen.has(v))return null;
    seen.add(v);
    for(const k of keys){
      if(typeof v[k]==='boolean')return v[k];
    }
    for(const x of Object.values(v)){
      const r=walk(x,depth+1);if(r!==null)return r;
    }
    return null;
  }
  return walk(root);
}
function mapCard(raw){
  const title=stringVal(first(raw,[
    'title','name','articleTitle','article_title','wikiTitle','wiki_title',
    'cardTitle','card_title','label'
  ]));
  let subtitle=stringVal(first(raw,[
    'subtitle','description','excerpt','summary','articleDescription',
    'article_description','wikiDescription','wiki_description'
  ]));
  if(!subtitle && raw.article && typeof raw.article==='object'){
    subtitle=stringVal(first(raw.article,['description','summary','excerpt','subtitle']));
  }

  const rarity=stringVal(first(raw,[
    'rarity','rarityCode','rarity_code','tier','grade','rarityName','rarity_name'
  ]));
  const apiId=stringVal(first(raw,['id','cardId','card_id','uuid','slug','key']));
  const image=findImage(raw);
  const wikiUrl=stringVal(first(raw,['wikipediaUrl','wikipedia_url','articleUrl','article_url','url']));
  const stable=apiId || hash(JSON.stringify(raw).slice(0,4000));
  const id='api_'+stable;

  return {
    id,
    apiId,
    title:title||`Carte ${stable}`,
    titleNorm:norm(title||''),
    subtitle,
    subtitleNorm:norm(subtitle),
    rarity,
    image,
    wikiUrl,
    seenAt:Date.now(),
    raw
  };
}
function paginationInfo(json,page,items){
  const totalPages=getDeepNumber(json,['totalPages','total_pages','pageCount','page_count','pages','lastPage','last_page']);
  const totalItems=getDeepNumber(json,['total','totalCount','total_count','count','totalItems','total_items']);
  const hasNext=getDeepBool(json,['hasNext','has_next','hasMore','has_more']);
  let next = hasNext!==null ? hasNext : (totalPages!==null ? page+1<totalPages : items.length>=50);
  return {page,totalPages,totalItems,hasNext:next};
}

async function apiSearch(q,page=0,sort='rarity'){
  const url=new URL('/api/cards',location.origin);
  url.searchParams.set('page',String(page));
  url.searchParams.set('q',q);
  url.searchParams.set('sort',sort);

  const r=await fetch(url.toString(),{
    method:'GET',
    headers:{'accept':'*/*'},
    credentials:'include'
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`API ${r.status}: ${text.slice(0,180)}`);

  let json;
  try{json=JSON.parse(text)}catch{throw new Error('Réponse API non JSON')}

  const arr=findBestArray(json);
  const cards=arr.map(mapCard).filter(c=>c.title);
  const pageInfo=paginationInfo(json,page,cards);

  await chrome.runtime.sendMessage({type:'DB_PUT_CARDS',cards});

  return {
    cards,
    pageInfo,
    debug:{
      topLevel:Array.isArray(json)?['[array]']:Object.keys(json||{}),
      rawSample:JSON.stringify(json).slice(0,2500)
    }
  };
}

// DOM export kept for wishlist until its endpoint is identified.
function visible(el){
  if(!el||!(el instanceof Element))return false;
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);
  return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';
}
function searchInput(){
  const ss=['input[type="search"]','input[placeholder*="recherch" i]','input[aria-label*="recherch" i]','input[placeholder*="search" i]'];
  for(const s of ss){const e=[...document.querySelectorAll(s)].find(visible);if(e)return e}
  return [...document.querySelectorAll('input')].filter(visible).find(e=>e.getBoundingClientRect().width>250)||null;
}
function setVal(el,v){
  const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
  d?.set?d.set.call(el,v):el.value=v;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
}
async function domSearch(q){
  const i=searchInput();if(!i)throw new Error('Champ de recherche WikiMasters introuvable');
  i.focus();setVal(i,q);
  i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
  i.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));
  await sleep(700);
}
function titleNodes(title){
  const t=norm(title);
  return [...document.querySelectorAll('body *')].filter(e=>{
    if(!visible(e)||e.children.length)return false;
    return norm(e.textContent)===t;
  });
}
function scoreContainer(el,title){
  if(!visible(el))return -1;
  const r=el.getBoundingClientRect();
  if(r.width<100||r.height<100||r.width>800||r.height>1000)return -1;
  if(!norm(el.innerText).includes(norm(title)))return -1;
  let s=0;
  if(el.querySelector('img'))s+=10;
  if(r.width<450)s+=5;
  if(r.height<800)s+=5;
  return s-(r.width*r.height)/100000;
}
function findCardDom(card){
  const ns=titleNodes(card.title);let best=null,bs=-1e9;
  for(const n of ns){
    let cur=n;
    for(let i=0;i<8&&cur&&cur!==document.body;i++,cur=cur.parentElement){
      const s=scoreContainer(cur,card.title);
      if(s>bs){bs=s;best=cur}
    }
  }
  return best;
}
function wishish(e){
  return /(ajouter.*liste de souhait|liste de souhait|souhait|wishlist)/i.test(
    [e.innerText,e.getAttribute('aria-label'),e.getAttribute('title'),e.className].filter(Boolean).join(' ')
  );
}
function wishButton(root){return root?[...root.querySelectorAll('button,a,[role="button"]')].filter(visible).find(wishish)||null:null}
function activeWish(e){
  return /(retirer|remove|déjà|deja|wishlisted|active|selected|true)/i.test(
    [e.innerText,e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('aria-pressed'),e.className].filter(Boolean).join(' ')
  );
}
function modalFor(card){
  const t=norm(card.title);
  const d=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="dialog" i]')]
    .filter(visible).find(e=>norm(e.innerText).includes(t));
  if(d)return d;
  const f=[...document.querySelectorAll('body *')].filter(e=>{
    if(!visible(e))return false;
    const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return s.position==='fixed'&&r.width>300&&r.height>180&&norm(e.innerText).includes(t);
  });
  f.sort((a,b)=>{
    const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
    return x.width*x.height-y.width*y.height;
  });
  return f[0]||null;
}
async function openWish(el,card){
  let b=wishButton(el);if(b)return b;
  const t=el.matches('a,button,[role="button"]')?el:el.querySelector('a,button,[role="button"]')||el;
  t.scrollIntoView({block:'center'});t.click();await sleep(420);
  return wishButton(modalFor(card));
}
function closeModal(){
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
}
async function exportCollection(id){
  if(WD.exporting)return;
  WD.exporting=true;WD.stop=false;
  try{
    const col=(await chrome.runtime.sendMessage({type:'COL_GET',id})).item;
    if(!col)throw new Error('Collection introuvable');
    const cards=(await chrome.runtime.sendMessage({type:'DB_GET_CARDS',ids:col.cardIds||[]})).items||[];
    let added=0,already=0,failed=0;
    for(let i=0;i<cards.length&&!WD.stop;i++){
      const c=cards[i];
      await domSearch(c.title);
      let el=findCardDom(c);
      if(!el){await sleep(350);el=findCardDom(c)}
      if(!el){failed++;continue}
      const b=await openWish(el,c);
      if(!b){failed++;closeModal();continue}
      if(activeWish(b))already++;
      else{b.click();added++;await sleep(320)}
      closeModal();await sleep(160);
      chrome.runtime.sendMessage({type:'WD_EXPORT_PROGRESS',i:i+1,total:cards.length,added,already,failed}).catch(()=>{});
    }
    chrome.runtime.sendMessage({type:'WD_EXPORT_DONE',added,already,failed}).catch(()=>{});
  }catch(e){
    chrome.runtime.sendMessage({type:'WD_ERROR',error:e.message||String(e)}).catch(()=>{});
  }finally{WD.exporting=false}
}


function wdMarketplaceListingId(value){
  const s=String(value||'').trim();
  const m=s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : '';
}

async function wdMarketplaceGetFromPage(value){
  const listingId=wdMarketplaceListingId(value);
  if(!listingId)throw new Error('ID d’enchère invalide.');

  const r=await fetch(`/api/marketplace/${listingId}`,{
    method:'GET',
    headers:{accept:'*/*'},
    credentials:'include',
    cache:'no-store'
  });

  const text=await r.text();
  if(!r.ok){
    throw new Error(`Enchère HTTP ${r.status}: ${text.slice(0,180)}`);
  }

  let data;
  try{data=JSON.parse(text)}catch{throw new Error('Réponse enchère non JSON.')}
  return {listingId,data,readAt:Date.now()};
}

async function wdMarketplaceBidFromPage(value,amount){
  const listingId=wdMarketplaceListingId(value);
  if(!listingId)throw new Error('ID d’enchère invalide.');

  const n=Number(amount);
  if(!Number.isFinite(n)||n<=0)throw new Error('Montant d’enchère invalide.');

  const r=await fetch(`/api/marketplace/${listingId}/bid`,{
    method:'POST',
    headers:{
      accept:'*/*',
      'content-type':'application/json'
    },
    credentials:'include',
    cache:'no-store',
    body:JSON.stringify({amount:n})
  });

  const text=await r.text();
  let data=null;
  if(text){
    try{data=JSON.parse(text)}catch{data=text}
  }

  if(!r.ok){
    const msg=typeof data==='string'
      ? data
      : (data?.error || data?.message || JSON.stringify(data||{}));
    throw new Error(`Enchère refusée (HTTP ${r.status})${msg?`: ${String(msg).slice(0,220)}`:''}`);
  }

  return {ok:true,status:r.status,data,listingId,amount:n};
}


window.addEventListener('message',e=>{
  if(e.source!==window)return;
  const d=e.data;
  if(!d || d.source!=='wikidex' || d.type!=='WD_MARKET_SCAN_PROGRESS')return;
  chrome.runtime.sendMessage({
    type:'WD_MARKET_SCAN_PROGRESS',
    detail:d.detail||{}
  }).catch(()=>{});
});

chrome.runtime.onMessage.addListener((m,s,send)=>{
  if(m.type==='WD_PING'){send({ok:true});return}
  if(m.type==='WD_MARKETPLACE_GET'){
    wdMarketplaceGetFromPage(m.listing).then(send).catch(e=>send({error:e.message||String(e)}));
    return true;
  }
  if(m.type==='WD_MARKETPLACE_BID'){
    wdMarketplaceBidFromPage(m.listing,m.amount).then(send).catch(e=>send({error:e.message||String(e)}));
    return true;
  }
  if(m.type==='WD_API_SEARCH'){
    apiSearch(m.q,m.page||0,m.sort||'rarity').then(send).catch(e=>send({error:e.message||String(e)}));
    return true;
  }
  if(m.type==='WD_EXPORT'){exportCollection(m.id);send({ok:true})}
  if(m.type==='WD_STOP'){WD.stop=true;send({ok:true})}
});
