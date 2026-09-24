
const DB_NAME='wikidex-db-v07', DB_VERSION=1;
const COLLECTIONS_BACKUP_KEY='wikidexCollectionsBackupV1';
const WISHLIST_SNAPSHOT_KEY='wikidexWishlistSnapshotV1';

function norm(s){
  return (s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
    .replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
}
function hash(s){
  let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36);
}
function first(obj,keys){
  for(const k of keys){
    if(obj && obj[k]!==undefined && obj[k]!==null && obj[k]!=='') return obj[k];
  }
  return null;
}
function stringVal(v){
  if(typeof v==='string') return v;
  if(v && typeof v==='object') return first(v,['name','title','label','value','code']) ?? '';
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
  if(typeof obj==='string')return looksImageUrl(obj)?obj:'';
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
      const r=walk(x,depth+1);
      if(r!==null)return r;
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
    for(const k of keys) if(typeof v[k]==='boolean') return v[k];
    for(const x of Object.values(v)){
      const r=walk(x,depth+1);
      if(r!==null)return r;
    }
    return null;
  }
  return walk(root);
}

function deepStringCandidates(root){
  const out=[];
  const seen=new Set();

  function walk(v,path=[],depth=0){
    if(depth>6 || v==null) return;

    if(typeof v==='string'){
      const s=v.trim();
      if(s) out.push({value:s,path});
      return;
    }

    if(typeof v!=='object' || seen.has(v)) return;
    seen.add(v);

    if(Array.isArray(v)){
      for(let i=0;i<Math.min(v.length,8);i++) walk(v[i],[...path,String(i)],depth+1);
      return;
    }

    for(const [k,x] of Object.entries(v)){
      walk(x,[...path,k],depth+1);
    }
  }

  walk(root);
  return out;
}

function scoreTextCandidate(candidate, kind){
  const value=candidate.value;
  const path=candidate.path.map(x=>String(x).toLowerCase());
  const leaf=path[path.length-1]||'';
  const full=path.join('.');

  if(!value || value.length>500) return -1e9;

  // Reject identifiers/URLs as human titles.
  if(/^https?:\/\//i.test(value)) return -1e9;
  if(/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)) return -1e9;
  if(/^[0-9a-f]{24,}$/i.test(value)) return -1e9;

  let s=0;

  if(kind==='title'){
    if(leaf==='title') s+=120;
    if(leaf==='name') s+=75;
    if(leaf==='label') s+=35;
    if(/articletitle|wiki.*title|card.*title/.test(leaf)) s+=140;

    if(/article|wikipedia|wiki|card|page|content/.test(full)) s+=35;
    if(/image|photo|author|user|owner|rarity|category|collection|market|price|id|uuid/.test(full)) s-=70;

    if(value.length>=3 && value.length<=100) s+=20;
    if(/[A-Za-zÀ-ÿ]/.test(value)) s+=10;
    if(/\s/.test(value)) s+=5;
  }

  if(kind==='subtitle'){
    if(/description|summary|excerpt|subtitle|extract/.test(leaf)) s+=120;
    if(/article|wikipedia|wiki|card|page|content/.test(full)) s+=25;
    if(/image|photo|author|user|owner|rarity|category|market|price|id|uuid/.test(full)) s-=70;

    if(value.length>=8 && value.length<=220) s+=20;
    if(/[A-Za-zÀ-ÿ]/.test(value)) s+=10;
  }

  return s;
}

function deepBestString(raw,kind){
  const candidates=deepStringCandidates(raw)
    .map(c=>({...c,score:scoreTextCandidate(c,kind)}))
    .sort((a,b)=>b.score-a.score);

  return candidates[0]?.score>0 ? candidates[0].value : '';
}

function humanizeSlug(s){
  if(!s) return '';
  if(/^https?:\/\//i.test(s)) return '';
  return String(s)
    .replace(/[-_]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .replace(/\b\w/g,m=>m.toUpperCase());
}

function mapCard(raw){
  // First try the common direct fields, then recurse through nested API objects.
  let title=stringVal(first(raw,[
    'title','name','articleTitle','article_title','wikiTitle','wiki_title',
    'cardTitle','card_title','label'
  ]));

  if(!title) title=deepBestString(raw,'title');

  let subtitle=stringVal(first(raw,[
    'subtitle','description','excerpt','summary','articleDescription',
    'article_description','wikiDescription','wiki_description'
  ]));

  if(!subtitle) subtitle=deepBestString(raw,'subtitle');

  // Avoid duplicating title as subtitle.
  if(norm(subtitle)===norm(title)) subtitle='';

  const rarity=stringVal(first(raw,[
    'rarity','rarityCode','rarity_code','tier','grade','rarityName','rarity_name'
  ]));

  const apiId=stringVal(first(raw,['id','cardId','card_id','uuid','key']));
  const slug=stringVal(first(raw,['slug','articleSlug','article_slug','wikiSlug','wiki_slug']));

  // Last meaningful fallback before "Carte <id>".
  if(!title && slug) title=humanizeSlug(slug);

  const image=findImage(raw);
  const wikiUrl=stringVal(first(raw,[
    'wikipediaUrl','wikipedia_url','articleUrl','article_url','url'
  ]));

  const stable=apiId || slug || hash(JSON.stringify(raw).slice(0,4000));
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
  return {
    page,
    totalPages,
    totalItems,
    hasNext: hasNext!==null ? hasNext : (totalPages!==null ? page+1<totalPages : items.length>=50)
  };
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      const d=r.result;
      if(!d.objectStoreNames.contains('cards')){
        const s=d.createObjectStore('cards',{keyPath:'id'});
        s.createIndex('titleNorm','titleNorm',{unique:false});
      }
      if(!d.objectStoreNames.contains('collections')){
        d.createObjectStore('collections',{keyPath:'id'});
      }
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}
function rq(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function store(name,mode='readonly'){
  const d=await openDb();
  return d.transaction(name,mode).objectStore(name);
}
async function putCards(cards){
  const s=await store('cards','readwrite');
  for(const c of cards||[])await rq(s.put(c));
  return cards?.length||0;
}
async function getCards(ids){
  const s=await store('cards'),out=[];
  for(const id of ids||[]){
    const c=await rq(s.get(id));
    if(c)out.push(c);
  }
  return out;
}
async function queryCards(q='',limit=300){
  const s=await store('cards'),all=await rq(s.getAll()),n=(q||'').trim().toLowerCase();
  let rows=n?all.filter(c=>(c.titleNorm||'').includes(n)||(c.subtitleNorm||'').includes(n)||(c.rarity||'').toLowerCase().includes(n)):all;
  rows.sort((a,b)=>(b.seenAt||0)-(a.seenAt||0));
  return {total:rows.length,items:rows.slice(0,limit)};
}
async function backupCollections(){
  const st=await store('collections');
  const rows=await rq(st.getAll());
  await chrome.storage.local.set({
    [COLLECTIONS_BACKUP_KEY]:{
      items:rows,
      savedAt:Date.now()
    }
  }).catch(()=>{});
}

async function restoreCollectionsBackupIfNeeded(){
  const st=await store('collections');
  const rows=await rq(st.getAll());
  if(rows.length)return rows;

  const obj=await chrome.storage.local.get(COLLECTIONS_BACKUP_KEY).catch(()=>({}));
  const backup=obj?.[COLLECTIONS_BACKUP_KEY];
  const items=Array.isArray(backup?.items)?backup.items:[];

  if(items.length){
    const w=await store('collections','readwrite');
    for(const c of items){
      if(c?.id)await rq(w.put(c));
    }
    return items;
  }

  return [];
}

async function listCollections(){
  const rows=await restoreCollectionsBackupIfNeeded();
  return rows.sort((a,b)=>(a.name||'').localeCompare(b.name||'','fr'));
}
async function getCollection(id){const s=await store('collections');return rq(s.get(id))}
async function saveCollection(c){
  const s=await store('collections','readwrite');
  await rq(s.put(c));
  await backupCollections();
  return c;
}
async function deleteCollection(id){
  const s=await store('collections','readwrite');
  await rq(s.delete(id));
  await backupCollections();
  return true;
}


const RARITY_RANK = {
  'L': 600,
  'UR': 500,
  'SR': 400,
  'R': 300,
  'PC': 200,
  'C': 100
};

function rarityRank(rarity){
  return RARITY_RANK[String(rarity||'').trim().toUpperCase()] || 0;
}

function wordBoundaryContains(text,query){
  const t=norm(text), q=norm(query);
  if(!t||!q)return false;
  const escaped=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  try{
    return new RegExp(`(^|[^a-z0-9à-ÿ])${escaped}([^a-z0-9à-ÿ]|$)`,'i').test(t);
  }catch{
    return t.includes(q);
  }
}

function relevanceBucket(card,query){
  const q=norm(query);
  const title=norm(card.title);
  const subtitle=norm(card.subtitle);

  if(!q)return 0;

  // 6 = exact title. This MUST dominate everything else.
  if(title===q) return 6;

  // "Comté (fromage)" should still be almost exact for "Comté".
  if(title.startsWith(q+' ') || title.startsWith(q+'(') || title.startsWith(q+' -')) return 5;

  // Whole-word title hit.
  if(wordBoundaryContains(title,q)) return 4;

  // Partial title hit.
  if(title.includes(q)) return 3;

  // Only description/subtitle contains the exact word.
  if(wordBoundaryContains(subtitle,q)) return 2;

  // Loose subtitle hit.
  if(subtitle.includes(q)) return 1;

  return 0;
}

function relevanceScore(card,query){
  const bucket=relevanceBucket(card,query);
  const title=norm(card.title);
  const q=norm(query);

  let score=bucket*100000;

  // Rarity sorts only inside a relevance family, never over an exact title.
  score += rarityRank(card.rarity)*100;

  // Prefer shorter titles for the same match class:
  // "Comté" over "Liste des communes de l'ancien comté de..."
  if(q && title){
    score -= Math.min(1000, Math.abs(title.length-q.length)*3);
  }

  // Small bonus when every query token appears in the title.
  const tokens=q.split(/\s+/).filter(Boolean);
  if(tokens.length && tokens.every(t=>title.includes(t))) score+=2500;

  return score;
}

function dedupeCards(cards){
  const m=new Map();
  for(const c of cards||[]){
    const old=m.get(c.id);
    if(!old || (c.image&&!old.image))m.set(c.id,c);
  }
  return [...m.values()];
}


async function fetchApiPage(q,page=0,sort='rarity',rarity=''){
  const url=new URL('https://www.wiki-masters.com/api/cards');
  url.searchParams.set('page',String(page));
  url.searchParams.set('q',q);
  if(rarity) url.searchParams.set('rarity',rarity);
  url.searchParams.set('sort',sort);

  const r=await fetch(url.toString(),{
    method:'GET',
    headers:{accept:'*/*'},
    credentials:'include'
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`API ${r.status}: ${text.slice(0,200)}`);

  let json;
  try{json=JSON.parse(text)}catch{throw new Error('Réponse API non JSON')}

  const arr=findBestArray(json);
  const cards=arr.map(mapCard).filter(c=>c.title);
  return {
    cards,
    pageInfo:paginationInfo(json,page,cards),
    json
  };
}





async function fetchApiPageMultiRarity(q,page=0,rarities=[],sort='rarity'){
  const url=new URL('https://www.wiki-masters.com/api/cards');
  url.searchParams.set('page',String(page));
  url.searchParams.set('q',q);

  for(const rarity of rarities){
    const r=String(rarity||'').trim().toUpperCase();
    if(['L','UR','SR','R','PC','C'].includes(r)){
      // WikiMasters uses repeated parameters:
      // ?rarity=L&rarity=UR
      url.searchParams.append('rarity',r);
    }
  }

  url.searchParams.set('sort',sort);

  const response=await fetch(url.toString(),{
    method:'GET',
    headers:{accept:'*/*'},
    credentials:'include'
  });

  const text=await response.text();
  if(!response.ok){
    throw new Error(`API ${response.status}: ${text.slice(0,200)}`);
  }

  let json;
  try{
    json=JSON.parse(text);
  }catch{
    throw new Error('Réponse API non JSON');
  }

  const arr=findBestArray(json);
  const cards=arr.map(mapCard).filter(c=>c.title);

  return {
    cards,
    pageInfo:paginationInfo(json,page,cards),
    json,
    requestUrl:url.toString()
  };
}

async function rarityFilteredSearch(q,rarities,page=0){
  const query=String(q||'').trim();
  const wanted=(rarities||[])
    .map(r=>String(r||'').trim().toUpperCase())
    .filter(r=>['L','UR','SR','R','PC','C'].includes(r));

  if(!query || !wanted.length){
    return {
      cards:[],
      selectedRarities:wanted,
      pageInfo:{page,totalPages:null,totalItems:0,hasNext:false},
      debug:{topLevel:[],rawSample:'',requestUrl:''}
    };
  }

  // Exact behavior observed in WikiMasters:
  // ?rarity=L&rarity=UR&sort=rarity
  const r=await fetchApiPageMultiRarity(query,page,wanted,'rarity');

  let cards=dedupeCards(r.cards||[]);

  for(const c of cards){
    c._relevanceBucket=relevanceBucket(c,query);
    c._relevanceScore=relevanceScore(c,query);
  }

  cards.sort((a,b)=>
    (b._relevanceScore-a._relevanceScore) ||
    (rarityRank(b.rarity)-rarityRank(a.rarity)) ||
    ((a.title||'').localeCompare(b.title||'','fr'))
  );

  await putCards(cards);

  return {
    cards,
    selectedRarities:wanted,
    pageInfo:r.pageInfo,
    debug:{
      topLevel:Array.isArray(r.json)?['[array]']:Object.keys(r.json||{}),
      rawSample:JSON.stringify(r.json).slice(0,3000),
      requestUrl:r.requestUrl
    }
  };
}


function cleanImportText(s){
  return norm(String(s||'')
    .replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu,' ')
    .replace(/[🔥👑🍾🧀🌋🚀]/gu,' ')
    .replace(/\s+/g,' ')
    .trim());
}

function importTokens(s){
  const stop=new Set(['de','du','des','la','le','les','et','en','a','au','aux','d','l']);
  return cleanImportText(s)
    .split(/[^a-z0-9]+/i)
    .map(x=>x.trim())
    .filter(x=>x.length>=3 && !stop.has(x));
}

function importCandidateScore(card,query,department){
  const q=cleanImportText(query);
  const title=cleanImportText(card.title);
  const subtitle=cleanImportText(card.subtitle);
  const dept=cleanImportText(department);

  if(!q || !title)return -1e9;

  let score=0;
  let mode='weak';

  if(title===q){
    score=1200;
    mode='exact';
  }else if(
    title.startsWith(q+' ') ||
    title.startsWith(q+'(') ||
    title.startsWith(q+' -') ||
    title.startsWith(q+' :')
  ){
    score=1050;
    mode='prefix';
  }else if(title.includes(q)){
    score=880;
    mode='title';
  }else if(q.includes(title) && title.length>=5){
    score=760;
    mode='inverse';
  }else{
    const qTokens=importTokens(q);
    const tTokens=new Set(importTokens(title));
    const overlap=qTokens.filter(x=>tTokens.has(x)).length;
    if(qTokens.length){
      score=Math.round((overlap/qTokens.length)*650);
      if(overlap===qTokens.length) mode='tokens';
    }

    if(subtitle.includes(q)){
      score=Math.max(score,560);
      mode='subtitle';
    }
  }

  // Department is extremely useful for homonyms:
  // Fort Boyard + Charente-Maritime => the monument card.
  let departmentMatch=false;
  if(dept){
    if(title.includes(dept) || subtitle.includes(dept)){
      score+=260;
      departmentMatch=true;
    }else{
      const dTokens=importTokens(dept);
      const hay=title+' '+subtitle;
      const hits=dTokens.filter(x=>hay.includes(x)).length;
      if(hits){
        score+=Math.min(180,hits*70);
        departmentMatch=true;
      }
    }
  }

  // Small rarity tiebreaker only. Relevance remains dominant.
  score += Math.round(rarityRank(card.rarity)/20);

  return {score,mode,departmentMatch};
}

async function resolveImportEntry(entry){
  const query=String(entry?.query||'').trim();
  const department=String(entry?.department||'').trim();

  if(!query){
    return {status:'missing',entry,candidates:[]};
  }

  // First pass: the tiers the user actually wants to prioritize.
  let first=await fetchApiPageMultiRarity(
    query,0,['L','UR','SR','R'],'rarity'
  );

  let cards=dedupeCards(first.cards||[]);

  function rank(list){
    return list.map(card=>{
      const m=importCandidateScore(card,query,department);
      return {card,...m};
    }).sort((a,b)=>b.score-a.score);
  }

  let ranked=rank(cards);

  // Only touch PC/C when the high-rarity pass does not produce a convincing match.
  if(!ranked.length || ranked[0].score<760){
    try{
      const fallback=await fetchApiPageMultiRarity(
        query,0,['PC','C'],'rarity'
      );
      cards=dedupeCards([...cards,...(fallback.cards||[])]);
      ranked=rank(cards);
    }catch{}
  }

  await putCards(cards);

  const top=ranked[0]||null;
  const second=ranked[1]||null;

  if(!top){
    return {status:'missing',entry,candidates:[]};
  }

  const gap=second ? top.score-second.score : 9999;

  // Strong automatic matches:
  // exact, prefix, or a department-backed title match.
  const strong =
    top.score>=1000 ||
    (top.score>=850 && top.departmentMatch) ||
    (top.score>=900 && gap>=70);

  if(strong){
    return {
      status:'matched',
      entry,
      card:top.card,
      score:top.score,
      mode:top.mode,
      candidates:ranked.slice(0,3).map(x=>({
        id:x.card.id,title:x.card.title,subtitle:x.card.subtitle,
        rarity:x.card.rarity,score:x.score
      }))
    };
  }

  // A plausible but ambiguous result is deliberately not auto-added.
  if(top.score>=650){
    return {
      status:'ambiguous',
      entry,
      score:top.score,
      candidates:ranked.slice(0,3).map(x=>({
        id:x.card.id,title:x.card.title,subtitle:x.card.subtitle,
        rarity:x.card.rarity,score:x.score
      }))
    };
  }

  return {
    status:'missing',
    entry,
    candidates:ranked.slice(0,3).map(x=>({
      id:x.card.id,title:x.card.title,subtitle:x.card.subtitle,
      rarity:x.card.rarity,score:x.score
    }))
  };
}

async function stableSearchPage(q,page=0){
  const query=String(q||'').trim();
  if(!query){
    return {
      cards:[],
      pageInfo:{page,totalPages:null,totalItems:0,hasNext:false},
      debug:{topLevel:[],rawSample:''}
    };
  }

  // IMPORTANT: only use the sort value actually observed in WikiMasters traffic.
  const r=await fetchApiPage(query,page,'rarity');
  let cards=dedupeCards(r.cards||[]);

  for(const c of cards){
    c._relevanceBucket=relevanceBucket(c,query);
    c._relevanceScore=relevanceScore(c,query);
  }

  cards.sort((a,b)=>
    (b._relevanceScore-a._relevanceScore) ||
    (rarityRank(b.rarity)-rarityRank(a.rarity)) ||
    ((a.title||'').localeCompare(b.title||'','fr'))
  );

  await putCards(cards);

  return {
    cards,
    pageInfo:r.pageInfo,
    debug:{
      topLevel:Array.isArray(r.json)?['[array]']:Object.keys(r.json||{}),
      rawSample:JSON.stringify(r.json).slice(0,3000)
    }
  };
}

async function fastSmartSearch(q){
  const query=String(q||'').trim();
  if(!query)return {
    cards:[],
    smartMeta:{pagesScanned:0,uniqueScanned:0,exactMatches:0,mode:'fast'},
    debug:{topLevel:[],rawSample:''}
  };

  // Small fixed budget: 3 rarity pages + 2 name pages = max 5 requests.
  const jobs=[
    fetchApiPage(query,0,'rarity').catch(()=>null),
    fetchApiPage(query,1,'rarity').catch(()=>null),
    fetchApiPage(query,2,'rarity').catch(()=>null),
    fetchApiPage(query,0,'name').catch(()=>null),
    fetchApiPage(query,1,'name').catch(()=>null)
  ];

  const rows=await Promise.all(jobs);
  let all=[],firstJson=null,firstPageInfo=null,pagesScanned=0;
  for(const r of rows){
    if(!r)continue;
    pagesScanned++;
    if(firstJson===null){firstJson=r.json;firstPageInfo=r.pageInfo}
    all.push(...(r.cards||[]));
  }

  all=dedupeCards(all);
  for(const c of all){
    c._relevanceBucket=relevanceBucket(c,query);
    c._relevanceScore=relevanceScore(c,query);
  }
  all.sort((a,b)=>
    (b._relevanceScore-a._relevanceScore) ||
    (rarityRank(b.rarity)-rarityRank(a.rarity)) ||
    ((a.title||'').localeCompare(b.title||'','fr'))
  );

  await putCards(all);

  return {
    cards:all.slice(0,200),
    pageInfo:{page:0,totalPages:1,totalItems:firstPageInfo?.totalItems??all.length,hasNext:false},
    smartMeta:{
      pagesScanned,
      uniqueScanned:all.length,
      exactMatches:all.filter(c=>relevanceBucket(c,query)===6).length,
      mode:'fast'
    },
    debug:{
      topLevel:Array.isArray(firstJson)?['[array]']:Object.keys(firstJson||{}),
      rawSample:JSON.stringify(firstJson).slice(0,3000)
    }
  };
}

async function boundedDeepSearch(q){
  const query=String(q||'').trim();
  if(!query)return fastSmartSearch(query);

  // Still bounded: max 12 pages total, each request has a timeout.
  const jobs=[];
  for(let p=0;p<6;p++) jobs.push(fetchApiPage(query,p,'rarity').catch(()=>null));
  for(let p=0;p<6;p++) jobs.push(fetchApiPage(query,p,'name').catch(()=>null));

  const rows=await Promise.all(jobs);
  let all=[],firstJson=null,firstPageInfo=null,pagesScanned=0;
  for(const r of rows){
    if(!r)continue;
    pagesScanned++;
    if(firstJson===null){firstJson=r.json;firstPageInfo=r.pageInfo}
    all.push(...(r.cards||[]));
  }

  all=dedupeCards(all);
  for(const c of all){
    c._relevanceBucket=relevanceBucket(c,query);
    c._relevanceScore=relevanceScore(c,query);
  }
  all.sort((a,b)=>
    (b._relevanceScore-a._relevanceScore) ||
    (rarityRank(b.rarity)-rarityRank(a.rarity)) ||
    ((a.title||'').localeCompare(b.title||'','fr'))
  );

  await putCards(all);

  return {
    cards:all.slice(0,300),
    pageInfo:{page:0,totalPages:1,totalItems:firstPageInfo?.totalItems??all.length,hasNext:false},
    smartMeta:{
      pagesScanned,
      uniqueScanned:all.length,
      exactMatches:all.filter(c=>relevanceBucket(c,query)===6).length,
      mode:'deep'
    },
    debug:{
      topLevel:Array.isArray(firstJson)?['[array]']:Object.keys(firstJson||{}),
      rawSample:JSON.stringify(firstJson).slice(0,3000)
    }
  };
}

async function smartApiSearch(q){
  const query=String(q||'').trim();
  if(!query) return {
    cards:[],
    pageInfo:{page:0,totalPages:1,totalItems:0,hasNext:false},
    smartMeta:{pagesScanned:0,uniqueScanned:0,exactMatches:0},
    debug:{topLevel:[],rawSample:''}
  };

  // Phase 1: collect several rarity-sorted pages so highly rare and broadly relevant
  // cards remain visible even if there is no exact title.
  const rarityPagesTarget=8;
  let all=[];
  let firstJson=null;
  let firstPageInfo=null;
  let rarityPagesScanned=0;

  for(let start=0;start<rarityPagesTarget;start+=4){
    const jobs=[];
    for(let p=start;p<Math.min(start+4,rarityPagesTarget);p++){
      jobs.push(fetchApiPage(query,p,'rarity').catch(()=>null));
    }
    const rows=await Promise.all(jobs);
    let any=false;
    for(const r of rows){
      if(!r) continue;
      any=true;
      rarityPagesScanned++;
      if(firstJson===null){firstJson=r.json;firstPageInfo=r.pageInfo}
      all.push(...(r.cards||[]));
    }
    // If a whole batch failed or is empty, don't keep pushing this strategy.
    if(!any) break;
  }

  all=dedupeCards(all);

  // Phase 2: exact-title hunter.
  // The API's "rarity" ordering can bury an exact title among hundreds of cards
  // that merely contain the query in their descriptions. Sorting by name is much
  // better for finding the canonical exact title.
  let exact=all.find(c=>relevanceBucket(c,query)===6) || null;
  let namePagesScanned=0;
  const exactHunterMaxPages=80;

  if(!exact){
    for(let start=0;start<exactHunterMaxPages;start+=5){
      const jobs=[];
      for(let p=start;p<Math.min(start+5,exactHunterMaxPages);p++){
        jobs.push(fetchApiPage(query,p,'name').catch(()=>null));
      }

      const rows=await Promise.all(jobs);
      let gotAny=false;
      let reachedEnd=false;

      for(const r of rows){
        if(!r) continue;
        gotAny=true;
        namePagesScanned++;
        all.push(...(r.cards||[]));

        // A short page usually means the filtered result set ended.
        if((r.cards||[]).length<50) reachedEnd=true;
      }

      all=dedupeCards(all);
      exact=all.find(c=>relevanceBucket(c,query)===6) || null;

      if(exact || reachedEnd || !gotAny) break;
    }
  }

  // Phase 3: if name-sorted search still did not find an exact title, continue
  // further through rarity pages, but with a hard cap to avoid pathological
  // one-letter searches crawling enormous portions of the catalog.
  let deepRarityPagesScanned=0;
  const deepRarityMaxPage=40;

  if(!exact){
    for(let start=rarityPagesTarget;start<deepRarityMaxPage;start+=4){
      const jobs=[];
      for(let p=start;p<Math.min(start+4,deepRarityMaxPage);p++){
        jobs.push(fetchApiPage(query,p,'rarity').catch(()=>null));
      }
      const rows=await Promise.all(jobs);
      let gotAny=false;
      let reachedEnd=false;

      for(const r of rows){
        if(!r) continue;
        gotAny=true;
        deepRarityPagesScanned++;
        all.push(...(r.cards||[]));
        if((r.cards||[]).length<50) reachedEnd=true;
      }

      all=dedupeCards(all);
      exact=all.find(c=>relevanceBucket(c,query)===6) || null;
      if(exact || reachedEnd || !gotAny) break;
    }
  }

  // Score globally after all strategies are merged.
  all=dedupeCards(all);
  for(const c of all){
    c._relevanceBucket=relevanceBucket(c,query);
    c._relevanceScore=relevanceScore(c,query);
  }

  all.sort((a,b)=>
    (b._relevanceScore-a._relevanceScore) ||
    (rarityRank(b.rarity)-rarityRank(a.rarity)) ||
    ((a.title||'').localeCompare(b.title||'','fr'))
  );

  await putCards(all);

  const exactMatches=all.filter(c=>relevanceBucket(c,query)===6).length;

  return {
    cards:all.slice(0,200),
    pageInfo:{
      page:0,
      totalPages:1,
      totalItems:firstPageInfo?.totalItems ?? all.length,
      hasNext:false
    },
    smartMeta:{
      pagesScanned:rarityPagesScanned+namePagesScanned+deepRarityPagesScanned,
      rarityPagesScanned,
      namePagesScanned,
      deepRarityPagesScanned,
      uniqueScanned:all.length,
      exactMatches,
      exactFound:!!exact,
      exactHunterMaxPages
    },
    debug:{
      topLevel:Array.isArray(firstJson)?['[array]']:Object.keys(firstJson||{}),
      rawSample:JSON.stringify(firstJson).slice(0,3000)
    }
  };
}

async function apiSearch(q,page=0,sort='rarity'){
  const url=new URL('https://www.wiki-masters.com/api/cards');
  url.searchParams.set('page',String(page));
  url.searchParams.set('q',q);
  url.searchParams.set('sort',sort);

  const r=await fetch(url.toString(),{
    method:'GET',
    headers:{accept:'*/*'},
    credentials:'include'
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`API ${r.status}: ${text.slice(0,200)}`);

  let json;
  try{json=JSON.parse(text)}catch{throw new Error('Réponse API non JSON')}

  const arr=findBestArray(json);
  const cards=arr.map(mapCard).filter(c=>c.title);
  await putCards(cards);

  return {
    cards,
    pageInfo:paginationInfo(json,page,cards),
    debug:{
      topLevel:Array.isArray(json)?['[array]']:Object.keys(json||{}),
      rawSample:JSON.stringify(json).slice(0,3000)
    }
  };
}


const WD_SUPABASE_URL="https://cyrxjeppjqsxxjayfrur.supabase.co";
const WD_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg";
const WD_SUPABASE_PROJECT="cyrxjeppjqsxxjayfrur";

function wdDecodeBase64Url(segment){
  try{
    let s=String(segment||'').replace(/-/g,'+').replace(/_/g,'/');
    while(s.length%4)s+='=';
    return decodeURIComponent(
      Array.from(atob(s))
        .map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0'))
        .join('')
    );
  }catch{return '';}
}

function wdJwtPayload(token){
  try{
    const parts=String(token||'').split('.');
    if(parts.length!==3)return null;
    return JSON.parse(wdDecodeBase64Url(parts[1]));
  }catch{return null;}
}

function wdLooksJwt(s){
  return typeof s==='string' && /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s.trim());
}

function wdFindAuthJwt(value,depth=0){
  if(depth>7 || value==null)return null;

  if(typeof value==='string'){
    let s=value.trim();

    // Direct JWT.
    if(wdLooksJwt(s)){
      const p=wdJwtPayload(s);
      if(p?.sub && (p?.role==='authenticated' || p?.aud==='authenticated')) return s;
    }

    // URL encoded values.
    try{
      const d=decodeURIComponent(s);
      if(d!==s){
        const x=wdFindAuthJwt(d,depth+1);
        if(x)return x;
      }
    }catch{}

    // Supabase SSR often prefixes serialized cookie values with base64-.
    if(s.startsWith('base64-')){
      try{
        let b=s.slice(7).replace(/-/g,'+').replace(/_/g,'/');
        while(b.length%4)b+='=';
        const decoded=atob(b);
        const x=wdFindAuthJwt(decoded,depth+1);
        if(x)return x;
      }catch{}
    }

    // JSON string / session object.
    if((s.startsWith('{')&&s.endsWith('}')) || (s.startsWith('[')&&s.endsWith(']'))){
      try{
        const x=wdFindAuthJwt(JSON.parse(s),depth+1);
        if(x)return x;
      }catch{}
    }

    // Last chance: extract JWT-looking substring from a larger cookie/storage string.
    const m=s.match(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
    if(m){
      for(const token of m){
        const p=wdJwtPayload(token);
        if(p?.sub && (p?.role==='authenticated' || p?.aud==='authenticated')) return token;
      }
    }
    return null;
  }

  if(Array.isArray(value)){
    for(const x of value){
      const token=wdFindAuthJwt(x,depth+1);
      if(token)return token;
    }
    return null;
  }

  if(typeof value==='object'){
    // Favor the actual Supabase session field.
    for(const k of ['access_token','accessToken','token']){
      if(value[k]){
        const token=wdFindAuthJwt(value[k],depth+1);
        if(token)return token;
      }
    }
    for(const x of Object.values(value)){
      const token=wdFindAuthJwt(x,depth+1);
      if(token)return token;
    }
  }

  return null;
}

async function wdSessionFromCookies(){
  const all=[];
  for(const url of ['https://www.wiki-masters.com/','https://wiki-masters.com/']){
    try{
      const cookies=await chrome.cookies.getAll({url});
      all.push(...cookies);
    }catch{}
  }

  const prefix=`sb-${WD_SUPABASE_PROJECT}-auth-token`;
  const matching=all.filter(c=>c.name===prefix || c.name.startsWith(prefix+'.'));

  // Supabase may split a large auth cookie into .0, .1, ...
  const chunks=matching
    .filter(c=>/^.+\.\d+$/.test(c.name))
    .sort((a,b)=>{
      const ai=Number(a.name.match(/\.(\d+)$/)?.[1]||0);
      const bi=Number(b.name.match(/\.(\d+)$/)?.[1]||0);
      return ai-bi;
    });

  const candidates=[];
  if(chunks.length)candidates.push(chunks.map(c=>c.value).join(''));
  for(const c of matching.filter(c=>c.name===prefix))candidates.push(c.value);

  for(const value of candidates){
    const token=wdFindAuthJwt(value);
    if(token)return token;
  }
  return null;
}

async function wdSessionFromPage(tabId){
  if(!tabId)return null;
  try{
    const out=await chrome.scripting.executeScript({
      target:{tabId},
      world:'MAIN',
      func:()=>{
        const values=[];
        try{
          values.push(document.cookie||'');
          for(let i=0;i<localStorage.length;i++){
            const k=localStorage.key(i);
            values.push(k||'');
            values.push(localStorage.getItem(k)||'');
          }
          for(let i=0;i<sessionStorage.length;i++){
            const k=sessionStorage.key(i);
            values.push(k||'');
            values.push(sessionStorage.getItem(k)||'');
          }
        }catch{}
        return values;
      }
    });
    for(const r of out||[]){
      const token=wdFindAuthJwt(r.result);
      if(token)return token;
    }
  }catch{}
  return null;
}

async function wdGetSupabaseSession(tabId){
  let token=await wdSessionFromCookies();
  if(!token)token=await wdSessionFromPage(tabId);
  if(!token){
    throw new Error('Session WikiMasters introuvable. Vérifie que tu es connecté sur wiki-masters.com.');
  }

  const payload=wdJwtPayload(token);
  if(!payload?.sub)throw new Error('Session WikiMasters invalide.');

  const now=Math.floor(Date.now()/1000);
  if(payload.exp && payload.exp<=now+10){
    throw new Error('Session WikiMasters expirée. Recharge le site ou reconnecte-toi.');
  }

  return {token,userId:payload.sub};
}

async function wdSupabaseRequest(path,session,options={}){
  const response=await fetch(WD_SUPABASE_URL+path,{
    method:options.method||'GET',
    headers:{
      'accept':'application/json',
      'apikey':WD_SUPABASE_ANON_KEY,
      'authorization':`Bearer ${session.token}`,
      'accept-profile':'public',
      'content-profile':'public',
      ...(options.body?{'content-type':'application/json'}:{}),
      ...(options.prefer?{'prefer':options.prefer}:{})
    },
    body:options.body ? JSON.stringify(options.body) : undefined
  });

  const text=await response.text();
  let data=null;
  if(text){
    try{data=JSON.parse(text)}catch{data=text}
  }

  return {ok:response.ok,status:response.status,data,text};
}

function wdChunks(arr,size){
  const out=[];
  for(let i=0;i<arr.length;i+=size)out.push(arr.slice(i,i+size));
  return out;
}

function wdApiCardId(card){
  const raw=String(card?.apiId||'').trim();
  if(raw)return raw;
  const id=String(card?.id||'');
  if(id.startsWith('api_'))return id.slice(4);
  return '';
}

async function wdExistingWishlist(session,cardIds){
  const existing=new Set();

  for(const chunk of wdChunks(cardIds,40)){
    const url=new URL(WD_SUPABASE_URL+'/rest/v1/wishlist_items');
    url.searchParams.set('select','card_id');
    url.searchParams.set('user_id',`eq.${session.userId}`);
    url.searchParams.set('card_id',`in.(${chunk.join(',')})`);

    const path=url.pathname+url.search;
    const r=await wdSupabaseRequest(path,session);
    if(!r.ok){
      throw new Error(`Lecture wishlist impossible (HTTP ${r.status}).`);
    }

    for(const row of Array.isArray(r.data)?r.data:[]){
      if(row?.card_id)existing.add(String(row.card_id));
    }
  }

  return existing;
}

async function wdInsertWishlistChunk(session,items){
  if(!items.length)return {added:[],failed:[]};

  // PostgREST supports array bodies for bulk INSERT.
  const body=items.map(x=>({
    user_id:session.userId,
    card_id:x.cardId
  }));

  const r=await wdSupabaseRequest('/rest/v1/wishlist_items',session,{
    method:'POST',
    body,
    prefer:'return=minimal'
  });

  if(r.ok){
    return {added:items,failed:[]};
  }

  // If the bulk insert fails, retry individually so one bad/duplicate item
  // doesn't invalidate an entire collection export.
  const added=[],failed=[];
  for(const item of items){
    const one=await wdSupabaseRequest('/rest/v1/wishlist_items',session,{
      method:'POST',
      body:{user_id:session.userId,card_id:item.cardId},
      prefer:'return=minimal'
    });

    if(one.ok){
      added.push(item);
    }else if(one.status===409 || /duplicate|unique/i.test(one.text||'')){
      // Race condition: card became wishlisted after the initial read.
      item.already=true;
      added.push(item);
    }else{
      failed.push({...item,status:one.status,error:one.text?.slice(0,180)||'Erreur'});
    }
  }

  return {added,failed};
}

async function wdExportWishlistApi(collectionId,tabId){
  const col=await getCollection(collectionId);
  if(!col)throw new Error('Collection introuvable.');

  const cards=await getCards(col.cardIds||[]);
  const usable=cards
    .map(card=>({card,cardId:wdApiCardId(card)}))
    .filter(x=>x.cardId);

  const invalid=cards.length-usable.length;
  if(!usable.length){
    return {total:cards.length,added:0,already:0,failed:invalid,invalid};
  }

  const session=await wdGetSupabaseSession(tabId);
  const ids=[...new Set(usable.map(x=>x.cardId))];
  const existing=await wdExistingWishlist(session,ids);

  const missing=usable.filter(x=>!existing.has(x.cardId));
  let added=0,failed=invalid;

  chrome.runtime.sendMessage({
    type:'WD_API_EXPORT_PROGRESS',
    total:usable.length,
    added:0,
    already:usable.length-missing.length,
    failed
  }).catch(()=>{});

  for(const chunk of wdChunks(missing,20)){
    const res=await wdInsertWishlistChunk(session,chunk);
    for(const x of res.added){
      if(!x.already)added++;
    }
    failed+=res.failed.length;

    chrome.runtime.sendMessage({
      type:'WD_API_EXPORT_PROGRESS',
      total:usable.length,
      added,
      already:(usable.length-missing.length)+res.added.filter(x=>x.already).length,
      failed
    }).catch(()=>{});
  }

  // Final authoritative read: useful after a duplicate race or partial retry.
  const finalExisting=await wdExistingWishlist(session,ids);
  const alreadyBefore=usable.length-missing.length;
  const nowPresent=usable.filter(x=>finalExisting.has(x.cardId)).length;
  const finalAdded=Math.max(0,nowPresent-alreadyBefore);
  const finalFailed=Math.max(invalid,usable.length-nowPresent+invalid);

  return {
    total:cards.length,
    added:finalAdded,
    already:alreadyBefore,
    present:nowPresent,
    failed:finalFailed,
    invalid
  };
}




async function wdAllWishlistCardIds(tabId=null){
  const session=await wdGetSupabaseSession(tabId);
  const ids=[];
  const limit=1000;

  for(let offset=0;offset<10000;offset+=limit){
    const url=new URL(WD_SUPABASE_URL+'/rest/v1/wishlist_items');
    url.searchParams.set('select','card_id');
    url.searchParams.set('user_id',`eq.${session.userId}`);
    url.searchParams.set('limit',String(limit));
    url.searchParams.set('offset',String(offset));

    const r=await wdSupabaseRequest(url.pathname+url.search,session);
    if(!r.ok){
      throw new Error(`Lecture wishlist impossible (HTTP ${r.status}).`);
    }

    const rows=Array.isArray(r.data)?r.data:[];
    for(const row of rows){
      if(row?.card_id)ids.push(String(row.card_id));
    }
    if(rows.length<limit)break;
  }

  const cardIds=[...new Set(ids)];
  const cards=[];
  let cardsLookupError='';

  // Enrich the wishlist with card titles so the marketplace can be searched
  // by text when its global feed is incomplete.
  for(const chunk of wdChunks(cardIds,80)){
    const url=new URL(WD_SUPABASE_URL+'/rest/v1/cards');
    url.searchParams.set('select','id,wikipedia_title,rarity');
    url.searchParams.set('id',`in.(${chunk.join(',')})`);

    const r=await wdSupabaseRequest(url.pathname+url.search,session);
    if(!r.ok){
      cardsLookupError=`cards HTTP ${r.status}: ${String(r.text||'').slice(0,120)}`;
      break;
    }

    for(const row of Array.isArray(r.data)?r.data:[]){
      if(!row?.id)continue;
      cards.push({
        id:String(row.id),
        title:String(row.wikipedia_title||''),
        rarity:String(row.rarity||'')
      });
    }
  }

  const snapshot={
    userId:session.userId,
    cardIds,
    cards,
    cardsLookupError,
    savedAt:Date.now()
  };

  await chrome.storage.local.set({
    [WISHLIST_SNAPSHOT_KEY]:snapshot
  }).catch(()=>{});

  return snapshot;
}

function wdNormalizeListingId(value){
  const s=String(value||'').trim();
  const m=s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : '';
}

async function wdMarketplaceGet(value){
  const listingId=wdNormalizeListingId(value);
  if(!listingId)throw new Error('ID d’enchère invalide.');

  const url=`https://www.wiki-masters.com/api/marketplace/${listingId}`;

  async function once(){
    const r=await fetch(url,{
      method:'GET',
      headers:{accept:'*/*'},
      credentials:'include',
      cache:'no-store'
    });

    const text=await r.text();
    if(!r.ok){
      const err=new Error(`Enchère HTTP ${r.status}: ${text.slice(0,180)}`);
      err.status=r.status;
      throw err;
    }

    let data;
    try{data=JSON.parse(text)}catch{throw new Error('Réponse enchère non JSON.')}
    return data;
  }

  let data;
  try{
    data=await once();
  }catch(e){
    // A short retry absorbs transient 404/5xx responses without sending
    // repeated bids or looping aggressively.
    if([404,500,502,503,504].includes(Number(e?.status))){
      await new Promise(r=>setTimeout(r,900));
      data=await once();
    }else{
      throw e;
    }
  }

  let userId=null;
  try{
    const session=await wdGetSupabaseSession(null);
    userId=session?.userId||null;
  }catch{}

  return {listingId,data,userId,readAt:Date.now()};
}

async function wdMarketplaceBid(value,amount){
  const listingId=wdNormalizeListingId(value);
  if(!listingId)throw new Error('ID d’enchère invalide.');

  const n=Number(amount);
  if(!Number.isFinite(n) || n<=0)throw new Error('Montant d’enchère invalide.');

  const r=await fetch(`https://www.wiki-masters.com/api/marketplace/${listingId}/bid`,{
    method:'POST',
    headers:{
      accept:'*/*',
      'content-type':'application/json'
    },
    credentials:'include',
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


const WD_BG_AUTOBID_KEY='wikidexAutoBidsV010';
const WD_BG_ENGINE_STATUS_KEY='wikidexAutoEngineStatusV1';
const WD_BG_BALANCE_KEY='wikidexWikiBidouBalanceV1';
const WD_BG_LOW_BALANCE_KEY='wikidexLowBalanceStateV1';
const WD_BG_LOW_BALANCE_THRESHOLD=100;
const WD_BG_INCREMENT_PCT=10;
const WD_BG_TICK_MIN_MS=2200;

let wdBgRunning=false;
let wdBgLastTickAt=0;
let wdBgLastBalanceReadAt=0;

function wdBgRoundMoney(n){
  return Math.round((Number(n)+Number.EPSILON)*100)/100;
}

function wdBgNextBid(base){
  const n=Number(base);
  if(!Number.isFinite(n)||n<0)return NaN;

  // WikiMasters: each new bid must be 10% above the previous one.
  // Wikibidous are treated as whole units, so always round upward.
  return Math.max(
    Math.ceil(n*(1+WD_BG_INCREMENT_PCT/100)),
    Math.floor(n)+1
  );
}

function wdBgAuctionTitle(a){
  return a?.card?.wikipedia_title ||
    a?.snapshot_search_document ||
    a?.card?.category ||
    'Enchère';
}

function wdBgAuctionClosed(a){
  const status=String(a?.status||'').toLowerCase();
  const closed=[
    'settled_sold','settled_unsold','sold','closed','expired',
    'cancelled','canceled','ended','settled'
  ];
  if(closed.includes(status))return true;
  const end=a?.end_at ? Date.parse(a.end_at) : NaN;
  return Number.isFinite(end) && end<=Date.now();
}

function wdBgAddLog(item,msg){
  item.logs=Array.isArray(item.logs)?item.logs:[];
  item.logs.unshift(`${new Date().toLocaleTimeString('fr-FR')} — ${msg}`);
  item.logs=item.logs.slice(0,12);
}

async function wdBgNotify(id,title,message){
  try{
    await chrome.notifications.create(
      `wikidex-${id}`,
      {
        type:'basic',
        iconUrl:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">'+
          '<rect width="128" height="128" rx="24" fill="#1f2937"/>'+
          '<text x="64" y="80" text-anchor="middle" font-size="64" font-family="Arial" font-weight="700" fill="white">W</text>'+
          '</svg>'
        ),
        title,
        message,
        priority:1
      }
    );
  }catch{}
}

async function wdBgFindWikiMastersTab(){
  const tabs=await chrome.tabs.query({
    url:[
      'https://www.wiki-masters.com/*',
      'https://wiki-masters.com/*'
    ]
  });

  tabs.sort((a,b)=>{
    function score(t){
      let n=0;
      if(String(t.url||'').startsWith('https://www.wiki-masters.com/'))n+=100;
      if(t.active)n+=20;
      if(t.status==='complete')n+=10;
      if(!t.discarded)n+=5;
      return n;
    }
    return score(b)-score(a);
  });

  for(const tab of tabs){
    if(!tab.id || tab.discarded)continue;
    try{
      const pong=await chrome.tabs.sendMessage(tab.id,{type:'WD_PING'});
      if(pong?.ok)return tab;
    }catch{}
  }

  return null;
}

async function wdBgPageGet(tabId,listingId){
  const r=await chrome.tabs.sendMessage(tabId,{
    type:'WD_MARKETPLACE_GET',
    listing:listingId
  });
  if(!r)throw new Error('Aucune réponse de l’onglet WikiMasters.');
  if(r.error)throw new Error(r.error);
  return r;
}

async function wdBgPageBid(tabId,listingId,amount){
  // IMPORTANT: exactly one POST call. Never retry this function automatically.
  const r=await chrome.tabs.sendMessage(tabId,{
    type:'WD_MARKETPLACE_BID',
    listing:listingId,
    amount
  });
  if(!r)throw new Error('Aucune réponse de l’onglet WikiMasters.');
  if(r.error)throw new Error(r.error);
  if(!r.ok)throw new Error('Enchère refusée.');
  return r;
}

async function wdBgPersistItem(runtimeItem){
  const obj=await chrome.storage.local.get(WD_BG_AUTOBID_KEY);
  const rows=Array.isArray(obj?.[WD_BG_AUTOBID_KEY])
    ? obj[WD_BG_AUTOBID_KEY]
    : [];

  const i=rows.findIndex(x=>x?.id===runtimeItem.id);
  if(i<0)return null;

  const latest=rows[i];

  // Keep user-editable values from the newest stored copy.
  const merged={
    ...latest,
    ...runtimeItem,
    max:latest.max,
    incrementPct:WD_BG_INCREMENT_PCT,
    enabled:latest.enabled===false ? false : runtimeItem.enabled
  };

  rows[i]=merged;
  await chrome.storage.local.set({[WD_BG_AUTOBID_KEY]:rows});
  return merged;
}

async function wdBgGetUserId(tabId,item){
  if(item?.userId)return item.userId;
  try{
    const session=await wdGetSupabaseSession(tabId);
    return session?.userId||null;
  }catch{
    return null;
  }
}

async function wdBgReadBalance(tabId){
  const out=await chrome.scripting.executeScript({
    target:{tabId},
    func:()=>{
      function visible(el){
        if(!(el instanceof Element))return false;
        const r=el.getBoundingClientRect();
        const st=getComputedStyle(el);
        return r.width>0 && r.height>0 &&
          st.display!=='none' &&
          st.visibility!=='hidden';
      }

      function parseNumber(raw){
        let x=String(raw||'')
          .replace(/[\s\u00A0\u202F]/g,'')
          .trim();

        if(!x)return null;

        const lastComma=x.lastIndexOf(',');
        const lastDot=x.lastIndexOf('.');
        const last=Math.max(lastComma,lastDot);

        if(last>=0){
          const decimals=x.length-last-1;
          if(decimals===1 || decimals===2){
            x=x.slice(0,last).replace(/[.,]/g,'')+
              '.'+
              x.slice(last+1).replace(/[.,]/g,'');
          }else{
            x=x.replace(/[.,]/g,'');
          }
        }

        const n=Number(x);
        return Number.isFinite(n)?n:null;
      }

      function extract(text){
        const src=String(text||'').replace(/\s+/g,' ').trim();
        if(!/wikibidou/i.test(src))return null;

        const before=src.match(
          /([0-9][0-9\s\u00A0\u202F.,]{0,24})\s*wikibidous?/i
        );
        if(before){
          const n=parseNumber(before[1]);
          if(n!==null)return n;
        }

        const after=src.match(
          /wikibidous?[^0-9]{0,24}([0-9][0-9\s\u00A0\u202F.,]{0,24})/i
        );
        if(after){
          const n=parseNumber(after[1]);
          if(n!==null)return n;
        }

        return null;
      }

      const candidates=[];
      const nodes=[
        ...document.querySelectorAll(
          'header,nav,button,a,div,span,[aria-label],[title]'
        )
      ];

      for(const el of nodes){
        if(!visible(el))continue;
        const own=[
          el.innerText||'',
          el.getAttribute?.('aria-label')||'',
          el.getAttribute?.('title')||''
        ].join(' ');

        if(!/wikibidou/i.test(own))continue;

        const variants=[
          el,
          el.parentElement,
          el.parentElement?.parentElement
        ].filter(Boolean);

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
          if(r.top>=0 && r.top<180)score+=25;
          if(txt.length<120)score+=20;

          candidates.push({amount,score});
        }
      }

      candidates.sort((a,b)=>b.score-a.score);
      return candidates[0]?.amount ?? null;
    }
  });

  const amount=Number(out?.[0]?.result);
  return Number.isFinite(amount)?amount:null;
}

async function wdBgCheckLowBalance(tabId){
  const now=Date.now();
  if(now-wdBgLastBalanceReadAt<30000)return;
  wdBgLastBalanceReadAt=now;

  let amount=null;
  try{
    amount=await wdBgReadBalance(tabId);
  }catch{
    return;
  }

  if(!Number.isFinite(amount))return;

  await chrome.storage.local.set({
    [WD_BG_BALANCE_KEY]:{
      amount,
      updatedAt:Date.now()
    }
  });

  const obj=await chrome.storage.local.get(WD_BG_LOW_BALANCE_KEY);
  const old=obj?.[WD_BG_LOW_BALANCE_KEY]||{};
  const low=amount<=WD_BG_LOW_BALANCE_THRESHOLD;

  if(low && !old.low){
    await wdBgNotify(
      'balance-low',
      'WikiDex · Solde faible',
      `${amount} Wikibidous disponibles (seuil : ${WD_BG_LOW_BALANCE_THRESHOLD}).`
    );
  }

  await chrome.storage.local.set({
    [WD_BG_LOW_BALANCE_KEY]:{
      low,
      amount,
      checkedAt:Date.now()
    }
  });
}

async function wdBgProcessOne(item,tabId){
  const now=Date.now();
  if(!item?.enabled)return item;
  if(item.nextPollAt && now<item.nextPollAt)return item;

  let r;
  try{
    r=await wdBgPageGet(tabId,item.listingId);
    item.lastSuccessAt=Date.now();
    item.consecutiveErrors=0;
    item.nextPollAt=0;
    item.lastError='';
  }catch(e){
    item.consecutiveErrors=(item.consecutiveErrors||0)+1;
    item.lastError=e.message||String(e);

    const delay=Math.min(
      30000,
      5000*Math.pow(2,Math.min(3,item.consecutiveErrors-1))
    );

    item.nextPollAt=Date.now()+delay;
    item.lastAction=
      `Lecture indisponible — nouvel essai dans ${Math.round(delay/1000)} s`;

    const sig=`${item.consecutiveErrors}|${item.lastError}`;
    if(item._lastErrorSig!==sig || item.consecutiveErrors<=2){
      wdBgAddLog(item,'Lecture impossible : '+item.lastError);
      item._lastErrorSig=sig;
    }

    await wdBgPersistItem(item);
    return item;
  }

  const a=r.data?.auction;
  if(!a){
    item.lastAction='Réponse invalide';
    await wdBgPersistItem(item);
    return item;
  }

  const previouslyHighest=!!(
    item.wasHighest ||
    (
      item.userId &&
      item.currentBidderId===item.userId
    )
  );

  item.userId=await wdBgGetUserId(tabId,item);
  item.title=wdBgAuctionTitle(a);
  item.currentBid=Number(a.current_bid ?? a.base_amount ?? 0);
  item.currentBidderId=a.current_bidder_id||null;
  item.status=a.status||'';
  item.endAt=a.end_at||null;
  item.sourceTabId=tabId;

  if(wdBgAuctionClosed(a)){
    item.enabled=false;

    const won=!!item.userId && (
      a.winner_id===item.userId ||
      a.current_bidder_id===item.userId
    );

    item.lastAction=won?'Terminée — gagnée':'Terminée';
    wdBgAddLog(
      item,
      item.lastAction+
      (a.final_price!=null?` à ${a.final_price}`:'')
    );

    if(won && !item.notifiedWon){
      item.notifiedWon=true;
      await wdBgNotify(
        `won-${item.listingId}`,
        'WikiDex · Enchère gagnée',
        `${item.title} — ${a.final_price ?? item.currentBid} Wikibidous`
      );
    }

    await wdBgPersistItem(item);
    return item;
  }

  if(!item.userId){
    item.lastAction='Session utilisateur introuvable';
    await wdBgPersistItem(item);
    return item;
  }

  if(a.seller_id===item.userId){
    item.enabled=false;
    item.lastAction='Arrêt — tu es le vendeur';
    wdBgAddLog(item,item.lastAction);
    await wdBgPersistItem(item);
    return item;
  }

  const isHighest=a.current_bidder_id===item.userId;

  if(isHighest){
    item.wasHighest=true;
    item.lastAction=`En tête à ${item.currentBid}`;
    await wdBgPersistItem(item);
    return item;
  }

  if(previouslyHighest){
    item.wasHighest=true;
    const outbidKey=
      `${a.current_bidder_id||'none'}|${item.currentBid}`;

    if(item.lastNotifiedOutbidKey!==outbidKey){
      item.lastNotifiedOutbidKey=outbidKey;
      await wdBgNotify(
        `outbid-${item.listingId}`,
        'WikiDex · Tu n’es plus en tête',
        `${item.title} — enchère actuelle : ${item.currentBid} Wikibidous`
      );
    }
  }

  // Synced external bids are monitored but must never place a bid
  // until the user explicitly configures an AutoBid ceiling.
  if(item.mode==='track'){
    item.lastAction=previouslyHighest
      ? `Suivi — dépassé à ${item.currentBid}`
      : `Suivi actif — mise actuelle ${item.currentBid}`;
    await wdBgPersistItem(item);
    return item;
  }

  const base=Number(a.current_bid ?? a.base_amount ?? 0);
  const next=wdBgNextBid(base);

  if(next>Number(item.max)+1e-9){
    item.enabled=false;
    item.lastAction=`Plafond atteint (${item.max})`;
    wdBgAddLog(
      item,
      `Pas de surenchère : +10 % ⇒ ${next} > plafond ${item.max}`
    );

    const capKey=`${base}|${item.max}`;
    if(item.notifiedCapKey!==capKey){
      item.notifiedCapKey=capKey;
      await wdBgNotify(
        `cap-${item.listingId}`,
        'WikiDex · Plafond atteint',
        `${item.title} — prochain palier ${next}, plafond ${item.max} Wikibidous.`
      );
    }

    await wdBgPersistItem(item);
    return item;
  }

  const attemptKey=
    `${a.current_bidder_id||'none'}|${base}|${next}`;
  const attemptNow=Date.now();

  if(
    item.lastAttemptKey===attemptKey &&
    attemptNow-(item.lastAttemptAt||0)<8000
  ){
    item.lastAction='Attente confirmation serveur';
    await wdBgPersistItem(item);
    return item;
  }

  const end=a.end_at ? Date.parse(a.end_at) : NaN;
  if(Number.isFinite(end) && end-Date.now()<500){
    item.lastAction='Fin imminente — aucun POST';
    await wdBgPersistItem(item);
    return item;
  }

  item.lastAttemptKey=attemptKey;
  item.lastAttemptAt=attemptNow;
  item.lastAction=`Surenchère ${next} en cours…`;

  // Persist the dedupe key BEFORE the POST.
  const persisted=await wdBgPersistItem(item);
  if(!persisted || persisted.enabled===false)return item;

  // Preserve the newest ceiling before committing the bid.
  item.max=persisted.max;
  item.incrementPct=WD_BG_INCREMENT_PCT;

  const recheckNext=wdBgNextBid(base);

  if(recheckNext>Number(item.max)+1e-9){
    item.enabled=false;
    item.lastAction=`Plafond atteint (${item.max})`;
    await wdBgPersistItem(item);
    return item;
  }

  try{
    // ONE write attempt only. No retry here or in the caller.
    await wdBgPageBid(tabId,item.listingId,recheckNext);
    item.lastAction=`Surenchère envoyée : ${recheckNext}`;
    wdBgAddLog(item,`POST /bid → ${recheckNext}`);
  }catch(e){
    item.lastAction='Enchère refusée';
    wdBgAddLog(item,'POST refusé : '+(e.message||String(e)));
  }

  await wdBgPersistItem(item);
  return item;
}

async function wdBgProcessAutoBids({force=false,itemId=null}={}){
  const now=Date.now();

  if(wdBgRunning)return {ok:true,skipped:'running'};
  if(!force && now-wdBgLastTickAt<WD_BG_TICK_MIN_MS){
    return {ok:true,skipped:'throttled'};
  }

  wdBgRunning=true;
  wdBgLastTickAt=now;

  try{
    const obj=await chrome.storage.local.get(WD_BG_AUTOBID_KEY);
    let items=Array.isArray(obj?.[WD_BG_AUTOBID_KEY])
      ? obj[WD_BG_AUTOBID_KEY]
      : [];

    const enabled=items.filter(x=>x?.enabled);
    if(!enabled.length){
      await chrome.storage.local.set({
        [WD_BG_ENGINE_STATUS_KEY]:{
          active:false,
          enabledCount:0,
          lastTickAt:Date.now(),
          reason:'no-enabled-autobids'
        }
      });
      return {ok:true,processed:0};
    }

    const tab=await wdBgFindWikiMastersTab();
    if(!tab){
      await chrome.storage.local.set({
        [WD_BG_ENGINE_STATUS_KEY]:{
          active:false,
          enabledCount:enabled.length,
          lastTickAt:Date.now(),
          reason:'no-wikimasters-tab'
        }
      });
      return {
        ok:false,
        error:'Aucun onglet WikiMasters disponible.'
      };
    }

    await wdBgCheckLowBalance(tab.id);

    const targets=itemId
      ? enabled.filter(x=>x.id===itemId)
      : enabled;

    for(const item of targets){
      await wdBgProcessOne({...item},tab.id);
    }

    const after=await chrome.storage.local.get(WD_BG_AUTOBID_KEY);
    items=Array.isArray(after?.[WD_BG_AUTOBID_KEY])
      ? after[WD_BG_AUTOBID_KEY]
      : [];

    await chrome.storage.local.set({
      [WD_BG_ENGINE_STATUS_KEY]:{
        active:true,
        enabledCount:items.filter(x=>x?.enabled).length,
        tabId:tab.id,
        lastTickAt:Date.now(),
        reason:'ok'
      }
    });

    return {ok:true,processed:targets.length};
  }finally{
    wdBgRunning=false;
  }
}

async function wdBgEnsureOffscreen(){
  const obj=await chrome.storage.local.get(WD_BG_AUTOBID_KEY);
  const items=Array.isArray(obj?.[WD_BG_AUTOBID_KEY])
    ? obj[WD_BG_AUTOBID_KEY]
    : [];
  const need=items.some(x=>x?.enabled);

  let has=false;
  try{
    has=await chrome.offscreen.hasDocument();
  }catch{}

  if(need && !has){
    try{
      await chrome.offscreen.createDocument({
        url:'offscreen.html',
        reasons:['WORKERS'],
        justification:
          'Maintain WikiDex auto-bid heartbeat while popup and side panel are closed.'
      });
    }catch(e){
      // Another event may have created it concurrently.
      if(!/already|single offscreen/i.test(String(e?.message||e))){
        throw e;
      }
    }
  }

  if(!need && has){
    try{
      await chrome.offscreen.closeDocument();
    }catch{}
  }
}

chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes[WD_BG_AUTOBID_KEY]){
    wdBgEnsureOffscreen().catch(()=>{});
  }
});

chrome.runtime.onStartup.addListener(()=>{
  wdBgEnsureOffscreen().catch(()=>{});
});

chrome.runtime.onInstalled.addListener(()=>{
  wdBgEnsureOffscreen().catch(()=>{});
});


chrome.runtime.onMessage.addListener((m,sender,send)=>{
  (async()=>{
    if(m.type==='AUTOBID_HEARTBEAT'){
      return await wdBgProcessAutoBids();
    }
    if(m.type==='AUTOBID_WAKE'){
      await wdBgEnsureOffscreen();
      return await wdBgProcessAutoBids({force:true});
    }
    if(m.type==='AUTOBID_PROCESS_ONE'){
      await wdBgEnsureOffscreen();
      return await wdBgProcessAutoBids({
        force:true,
        itemId:m.id||null
      });
    }
    if(m.type==='AUTOBID_STATUS'){
      const obj=await chrome.storage.local.get(WD_BG_ENGINE_STATUS_KEY);
      return obj?.[WD_BG_ENGINE_STATUS_KEY]||{
        active:false,
        enabledCount:0,
        lastTickAt:0,
        reason:'unknown'
      };
    }
    if(m.type==='SESSION_USER_ID'){
      const session=await wdGetSupabaseSession(m.tabId||null);
      return {userId:session.userId};
    }
    if(m.type==='WISHLIST_GET_ALL') return await wdAllWishlistCardIds(m.tabId||null);
    if(m.type==='MARKETPLACE_GET') return await wdMarketplaceGet(m.listing);
    if(m.type==='MARKETPLACE_BID') return await wdMarketplaceBid(m.listing,m.amount);
    if(m.type==='WISHLIST_EXPORT_API') return await wdExportWishlistApi(m.id,m.tabId);
    if(m.type==='IMPORT_RESOLVE_ONE') return await resolveImportEntry(m.entry);
    if(m.type==='API_SEARCH_RARITIES') return await rarityFilteredSearch(m.q,m.rarities,m.page||0);
    if(m.type==='API_SEARCH_PAGE') return await stableSearchPage(m.q,m.page||0);
    if(m.type==='API_SEARCH_FAST') return await fastSmartSearch(m.q);
    if(m.type==='API_SEARCH_DEEP') return await boundedDeepSearch(m.q);
    if(m.type==='API_SEARCH_SMART') return await smartApiSearch(m.q);
    if(m.type==='API_SEARCH') return await apiSearch(m.q,m.page||0,m.sort||'rarity');
    if(m.type==='DB_PUT_CARDS') return {count:await putCards(m.cards)};
    if(m.type==='DB_GET_CARDS') return {items:await getCards(m.ids)};
    if(m.type==='DB_QUERY') return await queryCards(m.q,m.limit);
    if(m.type==='COL_LIST') return {items:await listCollections()};
    if(m.type==='COL_GET') return {item:await getCollection(m.id)};
    if(m.type==='COL_SAVE') return {item:await saveCollection(m.collection)};
    if(m.type==='COL_DELETE') return {ok:await deleteCollection(m.id)};
    throw new Error('Message inconnu');
  })().then(send).catch(e=>send({error:e.message||String(e)}));
  return true;
});
