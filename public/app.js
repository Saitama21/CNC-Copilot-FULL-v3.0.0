(() => {
'use strict';
const D = window.CNC_DATA;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const lerp = (a,b,t) => a+(b-a)*clamp(t,0,1);
const round = (v,d=0) => { const p=10**d; return Math.round(v*p)/p; };
const uid = () => (crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const deep = x => JSON.parse(JSON.stringify(x));
const store = {
  get(k,fallback){ try{ const v=localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }catch{return fallback;} },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); window.dispatchEvent(new CustomEvent('cnc-local-data-changed',{detail:{key:k}})); return true; }catch(e){ console.warn('CNC Copilot storage write failed',e); return false; } }
};
const KEYS={machine:'cncFullMachineV1',tools:'cncFullToolsV2',projects:'cncFullProjectsV1',draft:'cncFullDraftV2',theme:'cncThemeMode',syncMarks:'cncFullSyncMarksV1'};

const themeMedia=matchMedia('(prefers-color-scheme: light)');
const themeModes=['system','light','dark'];
const themeLabels={system:'Системная',light:'Светлая',dark:'Тёмная'};
const themeIcons={system:'◐',light:'☀',dark:'☾'};
function applyThemeMode(mode,notify=false){
  if(!themeModes.includes(mode))mode='system';
  const effective=mode==='system'?(themeMedia.matches?'light':'dark'):mode;
  document.documentElement.dataset.themeMode=mode;
  document.documentElement.dataset.theme=effective;
  try{localStorage.setItem(KEYS.theme,mode)}catch{}
  const button=$('#themeToggle');
  if(button){button.textContent=themeIcons[mode];button.title=`Тема: ${themeLabels[mode]}`;button.setAttribute('aria-label',`Тема: ${themeLabels[mode]}. Нажать для переключения`)}
  const themeMeta=$('#themeColorMeta');if(themeMeta)themeMeta.content=effective==='light'?'#edf4fa':'#071019';
  const statusMeta=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(statusMeta)statusMeta.content=effective==='light'?'default':'black-translucent';
  if(notify)toast(`Тема: ${themeLabels[mode]}`);
}
function initTheme(){
  let mode='system';try{mode=localStorage.getItem(KEYS.theme)||'system'}catch{}
  applyThemeMode(mode);
  $('#themeToggle')?.addEventListener('click',()=>{const current=document.documentElement.dataset.themeMode||'system';applyThemeMode(themeModes[(themeModes.indexOf(current)+1)%themeModes.length],true)});
  const syncSystem=()=>{if((document.documentElement.dataset.themeMode||'system')==='system')applyThemeMode('system')};
  themeMedia.addEventListener?.('change',syncSystem);
}

function initAdaptiveDock(){
  const dock=$('.bottom-nav');if(!dock)return;
  let lastY=Math.max(0,window.scrollY),ticking=false;
  const show=()=>dock.classList.remove('dock-collapsed');
  const update=()=>{
    const y=Math.max(0,window.scrollY),delta=y-lastY;
    if(y<48||delta<-4)show();
    else if(y>120&&delta>4)dock.classList.add('dock-collapsed');
    lastY=y;ticking=false;
  };
  window.addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(update)}},{passive:true});
  dock.addEventListener('pointerdown',show,{passive:true});
  window.visualViewport?.addEventListener('resize',show,{passive:true});
}
// One-time, non-destructive migration from FULL v1.0.1 storage keys.
try{
  if(localStorage.getItem(KEYS.tools)==null){const old=store.get('cncFullToolsV1',null);if(Array.isArray(old)&&old.length)store.set(KEYS.tools,old)}
  if(localStorage.getItem(KEYS.draft)==null){const old=store.get('cncFullDraftV1',null);if(old&&typeof old==='object')store.set(KEYS.draft,{...old,selectedToolIds:old.selectedToolIds||[],requirements:old.requirements||[]})}
}catch(e){console.warn('CNC Copilot migration skipped',e)}

const state={
  view:'work',step:1,
  machine:store.get(KEYS.machine,deep(D.machineDefault)),
  materialId:'aisi304',
  stock:{diameter:50,length:100,unit:'mm',hardness:180},
  route:[],selectedToolIds:[],requirements:[],strategy:'work',coolant:'emulsion',rigidity:'medium',results:[],projectId:null
};
const savedDraft=store.get(KEYS.draft,null);
if(savedDraft){ try{Object.assign(state,savedDraft); state.machine=store.get(KEYS.machine,state.machine||deep(D.machineDefault)); state.results=[];state.selectedToolIds=Array.isArray(state.selectedToolIds)?state.selectedToolIds:[];state.requirements=Array.isArray(state.requirements)?state.requirements:[];}catch{} }

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1900)}
function transition(fn){if(document.startViewTransition){document.startViewTransition(fn)}else fn()}
function saveDraft(){const copy=deep(state);copy.results=[];store.set(KEYS.draft,copy)}
function allTools(){return [...D.tools.map(t=>({...t,libraryType:'catalog',quantity:t.quantity||null,location:t.location||'',photos:t.photos||{}})),...store.get(KEYS.tools,[]).map(t=>normalizeTool(t))]}
function projects(){return store.get(KEYS.projects,[])}
function saveProjects(v){markExistingProjectsActive(v);store.set(KEYS.projects,v);renderProjects()}
function material(){return D.materials.find(x=>x.id===state.materialId)||D.materials[0]}
function operation(id){return D.operations.find(x=>x.id===id)}
function opLabel(id){return operation(id)?.name||({rough:'Черновая',finish:'Чистовая'}[id]||id)}
function normalizeCode(v){return String(v||'').toUpperCase().replace(/[\s_\-./]+/g,'').replace(/[^A-Z0-9]/g,'')}
function canonicalToolKey(t){const raw=t?.nose,nose=(raw!==''&&raw!=null&&Number.isFinite(+raw))?Number(raw).toFixed(2):'';return [normalizeCode(t.insert),normalizeCode(t.grade),normalizeCode(t.breaker),nose].join('|')}
function syncToolKey(t){return t?.canonicalKey||canonicalToolKey(t)||t?.id||''}
function syncMarks(){const m=store.get(KEYS.syncMarks,{tools:{},projects:{}});return {tools:(m&&typeof m.tools==='object'&&m.tools)||{},projects:(m&&typeof m.projects==='object'&&m.projects)||{}}}
function markToolSync(t,deleted){const key=syncToolKey(t);if(!key)return;const m=syncMarks();m.tools[key]={deleted:!!deleted,at:new Date().toISOString()};store.set(KEYS.syncMarks,m)}
function markProjectSync(id,deleted){if(!id)return;const m=syncMarks();m.projects[id]={deleted:!!deleted,at:new Date().toISOString()};store.set(KEYS.syncMarks,m)}
function markExistingToolsActive(list){const m=syncMarks(),now=new Date().toISOString();for(const t of list){const key=syncToolKey(t);if(key)m.tools[key]={deleted:false,at:now}}store.set(KEYS.syncMarks,m)}
function markExistingProjectsActive(list){const m=syncMarks(),now=new Date().toISOString();for(const p of list){const key=p?.id||p?.name;if(key)m.projects[key]={deleted:false,at:now}}store.set(KEYS.syncMarks,m)}
function normalizeTool(t){const iso=Array.isArray(t.iso)?t.iso:[t.iso||'P'];const ops=Array.isArray(t.ops)?t.ops:['face','od'];return {...t,id:t.id||('local-'+uid()),iso,ops,passes:Array.isArray(t.passes)&&t.passes.length?t.passes:['rough','finish','single'],quantity:Math.max(0,(t.quantity===null||t.quantity===undefined||t.quantity==='')?1:(Number.isFinite(+t.quantity)?+t.quantity:1)),location:t.location||'',libraryType:t.libraryType||'cupboard',photos:t.photos||{},canonicalKey:t.canonicalKey||canonicalToolKey(t),source:t.source||'Мой шкаф',verified:t.verified??true,art:t.art||{shape:shapeFromInsert(t.insert),tone:'steel'}}}
function shapeFromInsert(insert){const c=String(insert||'').trim().toUpperCase()[0];return ({W:'wnmg',C:'ccmt',D:'dcmt',M:'mgmn',T:'thread'}[c]||'wnmg')}
function cupboardTools(){return store.get(KEYS.tools,[]).map(t=>normalizeTool(t))}
function saveCupboard(list){const normalized=list.map(normalizeTool);markExistingToolsActive(normalized);const ok=store.set(KEYS.tools,normalized);if(!ok){toast('Не хватило локальной памяти. Уменьши фото или удали старые карточки.');return false}renderTools();renderRoute();renderProcessToolTray();return true}
function materialAccentKey(m=material()){if(['pa6','pom'].includes(m.id))return m.id==='pa6'?'polymer':'polymer2';return m.iso}
function applyMaterialTheme(){const m=material(),root=document.documentElement;root.dataset.iso=m.iso;root.dataset.material=m.id;root.dataset.accent=materialAccentKey(m);}
function toolUseText(t){const ids=(t.ops||[]).filter((v,i,a)=>a.indexOf(v)===i);const labels=ids.map(opLabel).filter(Boolean);return labels.length?labels.join(' · '):'Назначение не задано'}
function noseLabel(t){return (t?.nose!==''&&t?.nose!=null&&Number.isFinite(+t.nose))?`R${Number(t.nose)}`:'R—'}
function isoDotsHtml(t){const pri=t.isoPriority||{},all=['P','M','K','N','S','H'];return `<div class="iso-dot-strip">${all.map(k=>{const st=pri[k]||((t.iso||[]).includes(k)?'secondary':'off');return `<span class="iso-dot iso-${k.toLowerCase()} ${st}" title="ISO ${k} · ${st}">${k}<i></i></span>`}).join('')}</div>`}
function requirementsForRoute(route){return (state.requirements||[]).filter(r=>r.operation==='all'||r.operation===route.opId)}
function isPrecisionRequirement(r){return r.type==='fit'||(r.type==='tolerance'&&+r.grade<=8)}
function requirementLabel(r){if(r.type==='tolerance')return `Ø${r.nominal} ${r.zone}${r.grade}`;if(r.type==='fit')return `Ø${r.nominal} ${r.fitName||r.fit}`;if(r.type==='thread')return `${r.thread} ${r.threadClass||''}`.trim();return r.text||'Требование'}
function stockMm(){const mul=state.stock.unit==='cm'?10:1;return{diameter:Math.max(.1,state.stock.diameter*mul),length:Math.max(.1,state.stock.length*mul)}}
function effectiveMaxRpm(){const m=state.machine;return m.setupMaxRpm?Math.min(m.maxRpm,m.setupMaxRpm):m.maxRpm}
function operationCount(opId){return state.route.reduce((n,r)=>n+(r.opId===opId?1:0),0)}
function firstResultPass(){for(const g of state.results){if(g.passes?.length)return g.passes[0]}return null}
function animateValue(el,to,dec=0,dur=720){
  if(!el)return;const from=Number(String(el.textContent).replace(',', '.'))||0,start=performance.now();
  function tick(ts){const p=clamp((ts-start)/dur,0,1),e=1-Math.pow(1-p,4),v=from+(to-from)*e;el.textContent=dec?v.toFixed(dec):String(Math.round(v)).padStart(el.id==='heroRpm'||el.id==='heroSinS'?4:1,'0');if(p<1)requestAnimationFrame(tick)}
  requestAnimationFrame(tick);
}
function syncHeroLive(res=null,animate=true){
  const rpm=res?.rpm||0,f=res?.f||0,vc=res?.targetVc||res?.vc||0,ap=res?.ap||0,max=Math.max(1,effectiveMaxRpm()),pct=clamp(rpm/max*100,0,100);
  const ring=$('#heroGaugeRing');if(ring)ring.style.setProperty('--gauge-pct',`${pct}%`);
  const cap=$('#heroGaugeCaption');if(cap)cap.textContent=`${Math.round(pct)}% · лимит ${max}`;
  const pairs=[['#heroRpm',rpm,0],['#heroSinS',rpm,0],['#heroSinF',f,3],['#heroSinVc',vc,1],['#heroSinAp',ap,3]];
  pairs.forEach(([sel,val,dec])=>animate?animateValue($(sel),val,dec):($(sel).textContent=dec?Number(val).toFixed(dec):String(Math.round(val)).padStart(sel.includes('Rpm')||sel.includes('SinS')?4:1,'0')));
}
function modeT(){return state.strategy==='safe'?.20:state.strategy==='productive'?.80:.50}
function rangeValue(arr,t=modeT()){if(!arr)return 0; if(t<=.5)return lerp(arr[0],arr[1],t*2); return lerp(arr[1],arr[2],(t-.5)*2)}
function passKey(opId,pass){if(opId==='thread_ext'||opId==='thread_int')return'thread';if(pass==='finish')return'finish';if(opId==='od')return'rough';return opId}

function navView(name){
  transition(()=>{
    state.view=name;
    $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
    $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  });
  if(name==='tools')renderTools(); if(name==='projects')renderProjects(); if(name==='reference')renderReference();
  window.scrollTo({top:0,behavior:'instant'});
}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>navView(b.dataset.view)));

function goStep(n,scroll=true){
  n=clamp(+n,1,5);state.step=n;
  document.documentElement.dataset.stepCurrent=String(n);
  document.body.classList.toggle('compact-work',n>1);
  transition(()=>{
    $$('[data-step-panel]').forEach(p=>p.classList.toggle('active',+p.dataset.stepPanel===n));
    $$('#stepper [data-step]').forEach(b=>{const s=+b.dataset.step;b.classList.toggle('active',s===n);b.classList.toggle('done',s<n)});
    $('#stepCaption').textContent=`Шаг ${n} из 5`;
  });
  saveDraft();
  if(scroll){
    const safeTop=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mobile-safe-top'))||0;
    setTimeout(()=>{
      const wiz=$('.wizard-wrap'),bar=$('.topbar');if(!wiz)return;
      const top=wiz.getBoundingClientRect().top+window.scrollY-((bar?.offsetHeight||62)+safeTop+14);
      window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
    },90);
  }
}
$$('[data-next-step]').forEach(b=>b.addEventListener('click',()=>goStep(b.dataset.nextStep)));
$$('#stepper [data-step]').forEach(b=>b.addEventListener('click',()=>goStep(b.dataset.step)));

function syncMachineUI(){
  const m=state.machine;
  $('#machineNameTitle').textContent=m.name;$('#machineMaxRpm').value=m.maxRpm;$('#machineKw').value=m.spindleKw;$('#machineEff').value=m.efficiency;
  $('#setupMaxRpm').value=m.setupMaxRpm||'';$('#tailstockMExtend').value=m.tailstockMExtend||'';$('#tailstockMRetract').value=m.tailstockMRetract||'';
  $('#topMachine').textContent=`${m.name.replace('Tengyue ','')} · 828D`;
}
$('#saveMachineProfile').addEventListener('click',()=>{
  state.machine.maxRpm=Math.max(100,+$('#machineMaxRpm').value||4000);state.machine.spindleKw=Math.max(1,+$('#machineKw').value||11);state.machine.efficiency=clamp(+$('#machineEff').value||.85,.5,1);
  state.machine.setupMaxRpm=$('#setupMaxRpm').value?Math.max(100,+$('#setupMaxRpm').value):null;state.machine.tailstockMExtend=$('#tailstockMExtend').value.trim();state.machine.tailstockMRetract=$('#tailstockMRetract').value.trim();
  store.set(KEYS.machine,state.machine);syncMachineUI();saveDraft();toast('Профиль станка сохранён локально');
});
$('#projectName').addEventListener('input',saveDraft);

function renderMaterials(){
  const box=$('#materialGrid');
  box.innerHTML=D.materials.map(m=>`<button class="material-card iso-tint ${m.id===state.materialId?'selected':''}" data-iso="${m.iso}" data-accent="${['pa6','pom'].includes(m.id)?(m.id==='pa6'?'polymer':'polymer2'):m.iso}" data-material="${m.id}"><i>ISO ${m.iso}</i><b>${m.short}</b><span>${m.name}</span></button>`).join('');
  box.querySelectorAll('[data-material]').forEach(b=>b.addEventListener('click',()=>{
    state.materialId=b.dataset.material;state.stock.hardness=material().hb;$('#stockHardness').value=state.stock.hardness;applyMaterialTheme();renderMaterials();updateMaterialInfo();renderOperationCatalog();renderProcessToolTray();saveDraft();
  }));
  $('#selectedIso').textContent=`ISO ${material().iso}`;applyMaterialTheme();
}
function updateMaterialInfo(){
  const m=material();applyMaterialTheme();$('#materialNote').innerHTML=`<b>${m.name}</b> · ${m.note}`;$('#selectedIso').textContent=`ISO ${m.iso}`;
  updateSlenderness();
}
function readStock(){state.stock.diameter=Math.max(.1,+$('#stockDiameter').value||.1);state.stock.length=Math.max(.1,+$('#stockLength').value||.1);state.stock.unit=$('#stockUnit').value;state.stock.hardness=Math.max(1,+$('#stockHardness').value||material().hb);updateSlenderness();saveDraft()}
['stockDiameter','stockLength','stockUnit','stockHardness'].forEach(id=>$('#'+id).addEventListener('input',readStock));
function syncStockUI(){ $('#stockDiameter').value=state.stock.diameter;$('#stockLength').value=state.stock.length;$('#stockUnit').value=state.stock.unit;$('#stockHardness').value=state.stock.hardness;updateMaterialInfo(); }
function updateSlenderness(){
  const s=stockMm(),ratio=s.length/s.diameter;let title='Жёсткая заготовка',desc='По отношению L/D дополнительная опора обычно не требуется.',cls='';
  if(ratio>=4){title='Задняя бабка настоятельно рекомендуется';desc='L/D высокий. Для наружного точения добавь центровку и опору, если геометрия детали позволяет.';cls='warn'}
  else if(ratio>=3){title='Проверь необходимость задней бабки';desc='L/D уже чувствителен к вылету. Copilot отметит операции, где опора полезна.';cls='warn'}
  $('#slendernessCard').innerHTML=`<div class="ratio">L/D ${ratio.toFixed(2)}</div><div><b>${title}</b><span>${desc}</span></div>`;$('#slendernessCard').classList.toggle('warn',!!cls);
}

function makeRoute(opId){
  const s=stockMm(),op=operation(opId);const base={uid:uid(),opId,pass:op.defaultPass,toolId:'auto',diameter:s.diameter,targetDiameter:round(s.diameter*.86,2),depth:round(s.length*.5,1),pitch:2,width:3,threadSize:'M16'};
  if(opId==='bore'){base.diameter=round(s.diameter*.45,2);base.targetDiameter=round(s.diameter*.55,2)}
  if(opId==='drill'){base.diameter=12;base.depth=Math.min(s.length,30)}
  if(opId==='center'){base.diameter=4;base.depth=2}
  if(opId==='groove'){base.depth=2;base.width=3}
  if(opId==='part'){base.width=3;base.depth=round(s.diameter/2,1)}
  if(opId==='thread_ext'){base.diameter=Math.min(16,s.diameter);base.pitch=2;base.threadSize='M16'}
  if(opId==='thread_int'){base.diameter=Math.min(16,s.diameter*.5);base.pitch=2;base.threadSize='M16'}
  return base;
}
function renderOperationCatalog(){
  const m=material();
  $('#operationCatalog').innerHTML=D.operations.map(o=>{const count=operationCount(o.id);const candidates=recommendCandidateTools(o.id);const assigned=candidates[0];return `<div class="op-add-wrap iso-tint" data-iso="${m.iso}"><button class="op-add ${count?'selected':''}" data-add-op="${o.id}" aria-pressed="${count?'true':'false'}"><strong>${o.icon}</strong><i class="op-plus">+</i>${count?`<em class="op-count">×${count}</em>`:''}<b>${o.name}</b><span>${o.description}</span><small>${assigned?`${esc(assigned.insert)} · ${assigned.libraryType==='cupboard'?'мой шкаф':'каталог'}`:'Нет подходящего инструмента'}</small></button>${count?`<button class="op-minus" data-minus-op="${o.id}" title="Убрать одну операцию">−</button>`:''}</div>`}).join('');
  $$('[data-add-op]').forEach(b=>b.addEventListener('click',()=>{state.route.push(makeRoute(b.dataset.addOp));renderRoute();saveDraft();toast(`${operation(b.dataset.addOp).name} · ${operationCount(b.dataset.addOp)} в маршруте`)}));
  $$('[data-minus-op]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const id=b.dataset.minusOp;for(let i=state.route.length-1;i>=0;i--){if(state.route[i].opId===id){state.route.splice(i,1);break}}renderRoute();saveDraft();toast(`${operation(id).name} · ${operationCount(id)} в маршруте`)}));
}
function recommendCandidateTools(opId){
  const op=operation(opId),iso=material().iso,all=allTools();
  let pool=state.selectedToolIds?.length?all.filter(t=>state.selectedToolIds.includes(t.id)):all;
  let c=pool.filter(t=>t.iso.includes(iso)&&t.ops.some(x=>op.toolOps.includes(x)));
  c.sort((a,b)=>((b.libraryType==='cupboard')-(a.libraryType==='cupboard'))+((b.quantity||0)-(a.quantity||0))+(+b.verified-+a.verified));
  return c;
}
function renderProcessToolTray(){
  const box=$('#processToolTray');if(!box)return;const local=cupboardTools();const all=local.length?local:D.tools.map(t=>({...t,libraryType:'catalog'}));
  if(!all.length){box.innerHTML='<div class="empty-mini">Шкаф пуст. Добавь инструмент вручную или через сканер.</div>';return}
  box.innerHTML=all.map(t=>{const on=state.selectedToolIds?.includes(t.id);const compatible=t.iso?.includes(material().iso);return `<button class="process-tool-chip ${on?'selected':''} ${compatible?'':'muted-tool'}" data-tray-tool="${t.id}">${toolThumbHtml(t,'tray-'+t.id)}<span><b>${esc(t.insert)}</b><small>${esc(t.location||t.holder||'без ячейки')} · ${t.quantity??'—'} шт.</small></span><i>${on?'✓':'+'}</i></button>`}).join('');
  box.querySelectorAll('[data-tray-tool]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.trayTool;state.selectedToolIds=state.selectedToolIds||[];state.selectedToolIds=state.selectedToolIds.includes(id)?state.selectedToolIds.filter(x=>x!==id):[...state.selectedToolIds,id];renderProcessToolTray();renderOperationCatalog();renderRoute();saveDraft()}));
  const cnt=state.selectedToolIds?.length||0;$('#toolTrayCount').textContent=cnt?`${cnt} выбрано`:'автоподбор';
}
function toolOptions(route){
  const op=operation(route.opId),m=material(),tools=allTools();
  let filtered=tools.filter(t=>t.iso.includes(m.iso)&&t.ops.some(x=>op.toolOps.includes(x)));
  if(state.selectedToolIds?.length)filtered=filtered.filter(t=>state.selectedToolIds.includes(t.id));
  filtered.sort((a,b)=>((b.libraryType==='cupboard')-(a.libraryType==='cupboard')));
  return `<option value="auto">Автоподбор из ${state.selectedToolIds?.length?'выбранных':'шкафа'}</option>`+filtered.map(t=>`<option value="${t.id}" ${route.toolId===t.id?'selected':''}>${t.libraryType==='cupboard'?'● ':''}${t.holder} · ${t.insert}</option>`).join('');
}
function opFields(r){
  const dia=`<label class="field">Ø расчёта, мм<input data-rid="${r.uid}" data-rfield="diameter" type="number" step="0.1" min="0.1" value="${r.diameter}"></label>`;
  if(r.opId==='od')return dia+`<label class="field">Ø после, мм<input data-rid="${r.uid}" data-rfield="targetDiameter" type="number" step="0.1" value="${r.targetDiameter}"></label>`;
  if(r.opId==='bore')return dia+`<label class="field">Ø расточить до, мм<input data-rid="${r.uid}" data-rfield="targetDiameter" type="number" step="0.1" value="${r.targetDiameter}"></label>`;
  if(r.opId==='groove')return dia+`<label class="field">Ширина, мм<input data-rid="${r.uid}" data-rfield="width" type="number" step="0.1" value="${r.width}"></label>`;
  if(r.opId==='part')return dia+`<label class="field">Пластина, мм<input data-rid="${r.uid}" data-rfield="width" type="number" step="0.1" value="${r.width}"></label>`;
  if(r.opId==='drill'||r.opId==='center')return dia+`<label class="field">Глубина, мм<input data-rid="${r.uid}" data-rfield="depth" type="number" step="0.1" value="${r.depth}"></label>`;
  if(r.opId.startsWith('thread'))return dia+`<label class="field">Шаг P, мм<input data-rid="${r.uid}" data-rfield="pitch" type="number" step="0.05" value="${r.pitch}"></label>`;
  return dia+`<label class="field">Глубина/длина, мм<input data-rid="${r.uid}" data-rfield="depth" type="number" step="0.1" value="${r.depth}"></label>`;
}
function renderRoute(){
  const n=state.route.length,word=(n%10===1&&n%100!==11)?'операция':([2,3,4].includes(n%10)&&![12,13,14].includes(n%100)?'операции':'операций');$('#routeCount').textContent=`${n} ${word}`;$('#routeEmpty').classList.toggle('hidden',n>0);
  const toolsCard=$('#processToolsCard');if(toolsCard)toolsCard.classList.toggle('hidden',n===0);
  const next=$('#toStrategyBtn');if(next){next.disabled=n===0;next.classList.toggle('is-disabled',n===0);next.setAttribute('aria-disabled',String(n===0));}
  renderOperationCatalog();renderProcessToolTray();
  const box=$('#routeList');
  box.innerHTML=state.route.map((r,i)=>{const op=operation(r.opId),assigned=recommendTool(r,r.pass==='finish'?'finish':'rough'),reqs=requirementsForRoute(r);return `<article class="route-item glass iso-tint" data-iso="${material().iso}" data-route="${r.uid}"><div class="route-order">${i+1}</div><div class="route-main"><div class="route-title-line"><div><h4>${op.icon} ${op.name}</h4><p>${op.description}</p></div><span class="assigned-mini">${assigned?.libraryType==='cupboard'?'● МОЙ ШКАФ':'○ КАТАЛОГ'}<b>${esc(assigned?.insert||'не назначено')}</b></span></div>${reqs.length?`<div class="route-requirements">${reqs.map(x=>`<span>${esc(requirementLabel(x))}</span>`).join('')}</div>`:''}${op.supportsPass?`<div class="pass-switch"><button data-pass="rough" data-rid="${r.uid}" class="${r.pass==='rough'?'active':''}">Черновая</button><button data-pass="finish" data-rid="${r.uid}" class="${r.pass==='finish'?'active':''}">Чистовая</button><button data-pass="both" data-rid="${r.uid}" class="${r.pass==='both'?'active':''}">Черновая + чистовая</button></div>`:''}<div class="route-controls">${opFields(r)}<label class="field tool-field">Инструмент<select data-rid="${r.uid}" data-rfield="toolId">${toolOptions(r)}</select></label></div></div><div class="route-actions"><button data-up="${r.uid}" title="Выше">↑</button><button data-down="${r.uid}" title="Ниже">↓</button><button data-remove="${r.uid}" title="Удалить">×</button></div></article>`}).join('');
  box.querySelectorAll('[data-pass]').forEach(b=>b.addEventListener('click',()=>{const r=state.route.find(x=>x.uid===b.dataset.rid);r.pass=b.dataset.pass;renderRoute();saveDraft()}));
  box.querySelectorAll('[data-rfield]').forEach(el=>el.addEventListener('input',()=>{const r=state.route.find(x=>x.uid===el.dataset.rid);r[el.dataset.rfield]=el.dataset.rfield==='toolId'?el.value:(+el.value||0);saveDraft()}));
  box.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{state.route=state.route.filter(x=>x.uid!==b.dataset.remove);renderRoute();saveDraft()}));
  box.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>moveRoute(b.dataset.up,-1)));box.querySelectorAll('[data-down]').forEach(b=>b.addEventListener('click',()=>moveRoute(b.dataset.down,1)));
}
function moveRoute(id,dir){const i=state.route.findIndex(x=>x.uid===id),j=i+dir;if(i<0||j<0||j>=state.route.length)return;[state.route[i],state.route[j]]=[state.route[j],state.route[i]];renderRoute();saveDraft()}
$('#toStrategyBtn').addEventListener('click',()=>{if(!state.route.length){toast('Сначала добавь хотя бы одну операцию');return}goStep(4);renderPreflight()});

$$('#strategySwitch [data-strategy]').forEach(b=>b.addEventListener('click',()=>{state.strategy=b.dataset.strategy;$$('#strategySwitch [data-strategy]').forEach(x=>x.classList.toggle('active',x===b));renderPreflight();saveDraft()}));
$('#coolant').addEventListener('change',()=>{state.coolant=$('#coolant').value;saveDraft()});$('#rigidity').addEventListener('change',()=>{state.rigidity=$('#rigidity').value;renderPreflight();saveDraft()});
function renderPreflight(){
  const s=stockMm(),ratio=s.length/s.diameter,m=state.machine,max=effectiveMaxRpm();const rows=[];
  rows.push({ok:true,t:`Станок: ${m.name}, лимит расчёта ${max} об/мин, ${m.spindleKw} кВт`});
  rows.push({ok:true,t:`Материал: ${material().name} · ISO ${material().iso} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм`});
  rows.push({ok:state.route.length>0,t:`Маршрут: ${state.route.length} операций · требований чертежа: ${(state.requirements||[]).length}`});
  const critical=(state.requirements||[]).filter(isPrecisionRequirement);if(critical.length)rows.push({ok:true,t:`Точность: ${critical.map(requirementLabel).slice(0,3).join(', ')}${critical.length>3?'…':''} — чистовые проходы будут разгружены и отмечены для контроля.`});
  state.route.forEach(r=>{if(requirementsForRoute(r).some(isPrecisionRequirement)&&operation(r.opId)?.supportsPass&&r.pass==='rough')rows.push({ok:false,t:`${operation(r.opId).name}: есть точный размер, но выбран только черновой проход. Проверь необходимость чистового.`})});
  if(ratio>=3)rows.push({ok:false,t:`L/D ${ratio.toFixed(2)} — проверь заднюю бабку и центровку для длинных наружных проходов.`});
  if(!m.setupMaxRpm)rows.push({ok:false,t:'Лимит текущего патрона/кулачков не задан — используется максимум станка.'});
  $('#preflight').innerHTML=rows.map(r=>`<div class="preflight-row ${r.ok?'':'warn'}"><i>${r.ok?'✓':'!'}</i><span>${r.t}</span></div>`).join('');
}

function recommendTool(route,pass){
  const op=operation(route.opId),iso=material().iso,tools=allTools();
  if(route.toolId!=='auto'){const manual=tools.find(t=>t.id===route.toolId);if(manual)return manual}
  let pool=state.selectedToolIds?.length?tools.filter(t=>state.selectedToolIds.includes(t.id)):tools;
  let c=pool.filter(t=>t.iso.includes(iso)&&t.ops.some(x=>op.toolOps.includes(x)));
  if(pass==='rough')c=c.filter(t=>!t.passes||t.passes.includes('rough')||t.ops.includes('rough'));
  if(pass==='finish')c=c.filter(t=>!t.passes||t.passes.includes('finish')||t.ops.includes('finish'));
  c.sort((a,b)=>((b.libraryType==='cupboard')-(a.libraryType==='cupboard'))+((b.passes?.includes(pass)?1:0)-(a.passes?.includes(pass)?1:0))+(+b.verified-+a.verified));
  if(c[0])return c[0];
  // Если выбранный набор не содержит подходящего инструмента — честно падаем в каталог, а не подменяем выбор случайной пластиной.
  const fallback=tools.filter(t=>t.iso.includes(iso)&&t.ops.some(x=>op.toolOps.includes(x))).sort((a,b)=>((b.libraryType==='cupboard')-(a.libraryType==='cupboard')));
  return fallback[0]||tools.find(t=>t.iso.includes(iso))||tools[0];
}
function calcPass(route,pass){
  const op=operation(route.opId),m=material(),machine=state.machine,key=passKey(route.opId,pass),r=m.ranges[key]||m.ranges.rough,t=modeT();
  let vc=rangeValue(r.vc,t),f=rangeValue(r.f,t),ap=rangeValue(r.ap,t);const dia=Math.max(.1,+route.diameter||stockMm().diameter);const tool=recommendTool(route,pass);
  const hardnessRatio=(state.stock.hardness||m.hb)/m.hb;if(hardnessRatio>1.05)vc/=Math.pow(hardnessRatio,.42);else if(hardnessRatio<.9)vc*=Math.min(1.08,Math.pow(1/hardnessRatio,.12));
  if(state.coolant==='dry'&&m.iso==='M')vc*=.82;else if(state.coolant==='oil'&&m.iso==='M')vc*=.96;
  if(state.rigidity==='low'){vc*=.88;f*=.90;ap*=.68}else if(state.rigidity==='high'){f*=1.04;ap*=1.08}
  const reqs=requirementsForRoute(route),precision=reqs.some(isPrecisionRequirement);
  if(pass==='finish'){ap=Math.min(ap,Math.max(.15,Math.abs((+route.diameter||dia)-(+route.targetDiameter||dia))*.3||ap));if(precision){f*=.88;ap=Math.min(ap,.45)}}
  else if(pass==='rough'&&precision){ap*=.92}
  let threadDepth=null,threadPasses=null;
  if(route.opId.startsWith('thread')){f=Math.max(.1,+route.pitch||1.5);threadDepth=.6134*f;ap=clamp(rangeValue(r.ap,t),.08,Math.max(.1,threadDepth*.45));threadPasses=Math.max(3,Math.ceil(threadDepth/ap)+2)}
  const rawRpm=1000*vc/(Math.PI*dia),limit=effectiveMaxRpm();let rpm=Math.min(rawRpm,limit),actualVc=Math.PI*dia*rpm/1000;
  let q=ap*f*actualVc;let pc=m.kc*q/60000; if(['groove','part'].includes(route.opId))pc*=Math.max(1,(+route.width||3)/2); if(['drill','center'].includes(route.opId))pc*=.65;
  let motor=pc/Math.max(.5,machine.efficiency||.85),powerLimited=false;
  if(motor>machine.spindleKw*.88 && ['od','face','bore'].includes(route.opId) && pass!=='finish'){
    const scale=clamp((machine.spindleKw*.78)/motor,.35,1);ap*=scale;q=ap*f*actualVc;pc=m.kc*q/60000;motor=pc/(machine.efficiency||.85);powerLimited=true;
  }
  let ra=null;if(tool.nose>0&&['od','face','bore'].includes(route.opId)){ra=(f*f/(32*tool.nose))*1000}
  const tailstock=shouldUseTailstock(route);
  const trial={rpm:round(rpm*(route.opId.startsWith('thread')?.86:.90)),f:round(route.opId.startsWith('thread')?f:f*.84,3),ap:round(ap*(route.opId.startsWith('thread')?.75:.55),3)};trial.vc=round(Math.PI*dia*trial.rpm/1000,1);
  return {id:`${route.uid}:${pass}`,routeUid:route.uid,opId:route.opId,pass,diameter:dia,toolId:tool.id,tool:deep(tool),vc:round(actualVc,1),targetVc:round(vc,1),rpm:round(rpm),rawRpm:round(rawRpm),f:round(f,3),ap:round(ap,3),power:round(motor,2),powerPct:round(motor/machine.spindleKw*100),ra:ra==null?null:round(ra,2),rpmLimited:rawRpm>limit,powerLimited,threadDepth:threadDepth==null?null:round(threadDepth,3),threadPasses,trial,verified:false,revision:0,lastFeedback:null,tailstock,range:deep(r),requirements:deep(reqs),precision};
}
function shouldUseTailstock(route){const s=stockMm(),ratio=s.length/s.diameter;return state.machine.tailstock&&ratio>=3&&['od'].includes(route.opId)}
function calculateRoute(){
  state.results=state.route.map(route=>{const op=operation(route.opId),passes=op.supportsPass?(route.pass==='both'?['rough','finish']:[route.pass]):['single'];return{routeUid:route.uid,opId:route.opId,name:op.name,passes:passes.map(p=>calcPass(route,p))}});
}
function animateOverlay(){return new Promise(resolve=>{
  const ov=$('#calcOverlay'),a=$('#spinDigitA'),b=$('#spinDigitB');ov.classList.remove('hidden');let n=0;const start=performance.now();
  function frame(ts){const t=(ts-start)/1250;n++;a.textContent=String(Math.floor(400+Math.random()*3200)).padStart(4,'0');b.textContent=(Math.random()*.5).toFixed(3);if(t<1)requestAnimationFrame(frame);else{setTimeout(()=>{ov.classList.add('hidden');resolve()},160)}}requestAnimationFrame(frame);
  });}
$('#calculateAllBtn').addEventListener('click',async()=>{if(!state.route.length){toast('Маршрут пуст');return}readStock();state.coolant=$('#coolant').value;state.rigidity=$('#rigidity').value;await animateOverlay();calculateRoute();renderResults(true);goStep(5);saveDraft()});

function toolSvg(tool,idSeed='x'){
  const tone=tool.art?.tone||'steel',shape=tool.art?.shape||'wnmg';const colors={gold:['#f7d98b','#b98325','#5b3d0d'],bronze:['#e0a25d','#9a562d','#4a261b'],silver:['#dbe5eb','#778791','#303b42'],steel:['#aebac2','#5f707b','#26323a']}[tone]||['#dbe5eb','#778791','#303b42'];
  const gid='g'+String(idSeed).replace(/[^a-z0-9]/gi,'');let insert='';
  if(shape==='wnmg')insert=`<polygon points="58,12 91,36 75,66 36,66 20,36" fill="url(#${gid})" stroke="#f5e1a6" stroke-width="2"/><polygon points="58,22 79,37 68,56 43,56 31,37" fill="#3f2f18" opacity=".55"/><circle cx="56" cy="39" r="8" fill="#111820" stroke="#ddc27f"/>`;
  else if(shape==='ccmt')insert=`<polygon points="37,16 88,27 79,64 28,53" fill="url(#${gid})" stroke="#f4e0a1" stroke-width="2"/><circle cx="58" cy="40" r="8" fill="#111820" stroke="#d8bf79"/>`;
  else if(shape==='dcmt')insert=`<polygon points="20,40 57,14 94,40 57,62" fill="url(#${gid})" stroke="#e9eef1" stroke-width="2"/><circle cx="57" cy="39" r="7" fill="#111820"/>`;
  else if(shape==='mgmn')insert=`<rect x="39" y="20" width="38" height="38" rx="5" fill="url(#${gid})" stroke="#f2d083" stroke-width="2"/><rect x="49" y="29" width="18" height="20" rx="3" fill="#4b3515"/>`;
  else if(shape==='thread')insert=`<polygon points="27,55 57,16 87,55" fill="url(#${gid})" stroke="#f3d68e" stroke-width="2"/><circle cx="57" cy="42" r="6" fill="#171c20"/>`;
  else if(shape==='drill')return `<svg viewBox="0 0 120 80" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" x2="1"><stop stop-color="${colors[0]}"/><stop offset=".45" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient></defs><g transform="translate(12 8) rotate(-8 50 30)"><rect x="10" y="24" width="90" height="18" rx="9" fill="url(#${gid})"/><path d="M18 25 C34 49 45 18 60 42 S84 18 98 39" fill="none" stroke="#27323a" stroke-width="5" opacity=".65"/><polygon points="98,24 113,33 98,42" fill="${colors[0]}"/></g></svg>`;
  return `<svg viewBox="0 0 120 80" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" x2="1"><stop stop-color="${colors[0]}"/><stop offset=".5" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient></defs><g transform="translate(3 3)"><path d="M3 58 L47 48 L75 55 L116 47 L116 68 L74 73 L45 66 L3 70Z" fill="#596671"/><path d="M3 58 L47 48 L75 55 L116 47" fill="none" stroke="#96a3ac" stroke-width="3"/>${insert}</g></svg>`;
}
function toolThumbHtml(tool,idSeed='tool'){
  const front=tool?.photos?.front||tool?.photos?.box||'';
  if(front)return `<img src="${front}" alt="${esc(tool.insert||'Пластина')}" loading="lazy">`;
  return toolSvg(tool,idSeed);
}
function toolSideThumb(tool){const side=tool?.photos?.side||'';return side?`<img class="tool-side-thumb" src="${side}" alt="Торец пластинки" loading="lazy">`:''}
function animateNumber(el,to,dec=0){const from=0,start=performance.now(),dur=650+Math.random()*280;function tick(ts){const p=clamp((ts-start)/dur,0,1),e=1-Math.pow(1-p,4),v=from+(to-from)*e;el.textContent=dec?v.toFixed(dec):Math.round(v);if(p<1)requestAnimationFrame(tick)}requestAnimationFrame(tick)}
function passLabel(p){return p==='rough'?'Черновой проход':p==='finish'?'Чистовой проход':'Рабочий проход'}
function sinumerikNote(res){const route=state.route.find(x=>x.uid===res.routeUid),op=operation(res.opId),max=effectiveMaxRpm();let extra='';
  if(res.opId.startsWith('thread'))extra=`Резьба: P ${route.pitch} мм · ориентир ${res.threadPasses} проходов · радиальная глубина профиля ≈ ${res.threadDepth} мм.`;
  if(res.tailstock)extra+=` Задняя бабка: Разное → Установки → Задняя бабка = Да; задай XRR. ${state.machine.tailstockMExtend?`OEM подвод: ${state.machine.tailstockMExtend}.`:''}`;
  return `${op.shopturn} ${extra} Лимит шпинделя для расчёта: ${max} об/мин.`;
}
function resultPassHtml(res,idx){
  const t=res.tool,trial=res.trial,isMine=t.libraryType==='cupboard',reqs=res.requirements||[];const reqHtml=reqs.length?`<div class="result-requirements"><small>ТРЕБОВАНИЯ ЧЕРТЕЖА</small>${reqs.map(r=>`<span>${esc(requirementLabel(r))}${isPrecisionRequirement(r)?' · контроль после чистового':''}</span>`).join('')}</div>`:'';
  return `<div class="pass-block" data-pass-id="${res.id}"><div class="pass-head"><b>${passLabel(res.pass)}</b><span>${res.verified?'✓ подтверждён на станке':`версия режима ${res.revision+1}`}</span></div><div class="metric-grid"><div class="metric rpm"><small>S · ШПИНДЕЛЬ</small><b data-anim="${res.rpm}" data-dec="0">0</b><span>об/мин</span></div><div class="metric feed"><small>f · ПОДАЧА</small><b data-anim="${res.f}" data-dec="3">0.000</b><span>мм/об</span></div><div class="metric vc"><small>Vc · ФАКТ.</small><b data-anim="${res.vc}" data-dec="1">0.0</b><span>м/мин</span></div><div class="metric ap"><small>ap · ГЛУБИНА</small><b data-anim="${res.ap}" data-dec="3">0.000</b><span>мм</span></div></div><div class="secondary-metrics"><div><small>Мощность мотора</small><b>${res.power} кВт · ${res.powerPct}%</b></div><div><small>Ra теоретическая</small><b>${res.ra==null?'—':res.ra+' мкм'}</b></div><div><small>Ограничения</small><b>${res.rpmLimited?'лимит оборотов ':''}${res.powerLimited?'лимит мощности':''}${!res.rpmLimited&&!res.powerLimited?'норма':''}</b></div></div>${reqHtml}<div class="tool-recommendation my-tool-card iso-tint" data-iso="${material().iso}"><div class="tool-art real-tool-art">${toolThumbHtml(t,res.id)}${toolSideThumb(t)}</div><div class="tool-copy"><small>${isMine?'МОЙ ИНСТРУМЕНТ':'КАТАЛОГ · НЕТ ПОДТВЕРЖДЁННОГО В ШКАФУ'}</small><b>${esc(t.holder||'Державка не указана')}</b><span>${esc(t.insert)} · ${esc(t.grade)} · ${esc(t.breaker)} · ${noseLabel(t)}<br>${isMine?`${esc(t.location||'ячейка не задана')} · ${t.quantity||0} шт. · ${toolUseText(t)}`:`${esc(t.source)} · добавь/отсканируй свой инструмент, чтобы привязать реальную ячейку`}</span></div></div><div class="sinumerik-box"><div class="sin-head"><span>SIEMENS</span><b>SINUMERIK 828D / ShopTurn</b></div><div class="sin-screen"><div><small>S / LIMS</small><b>${res.rpm}</b></div><div><small>F · G95</small><b>${res.f}</b></div><div><small>Vc · G96</small><b>${res.targetVc}</b></div><div><small>ap</small><b>${res.ap}</b></div></div></div><div class="shopturn-note">${sinumerikNote(res)}</div><div class="trial-zone"><div><div><h4>Первый пробный проход</h4><p>Оценка относится только к этой операции и этому проходу.</p></div><span class="badge ${res.verified?'green':''}">${res.verified?'ПРОВЕРЕНО':'СТАРТОВЫЙ РЕЖИМ'}</span></div><div class="trial-mini"><span>S ${trial.rpm} об/мин</span><span>f ${trial.f} мм/об</span><span>ap ${trial.ap} мм</span><span>Vc ${trial.vc} м/мин</span></div><div class="feedback-buttons">${Object.entries(D.feedbackRules).map(([id,r])=>`<button class="${id==='good'?'good':''}" data-feedback="${id}" data-pass="${res.id}">${r.icon} ${r.label}</button>`).join('')}</div><div class="adjust-host" id="adjust-${cssSafe(res.id)}"></div></div></div>`;
}
function cssSafe(s){return s.replace(/[^a-zA-Z0-9_-]/g,'_')}
function renderResults(animate=false){
  const s=stockMm(),m=material();$('#resultSubtitle').textContent=`${m.name} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм · ${state.route.length} операций`;
  $('#resultSummary').innerHTML=`<div class="summary-cell"><small>СТАНОК</small><b>${state.machine.name}</b></div><div class="summary-cell"><small>МАТЕРИАЛ</small><b>${m.short} · ISO ${m.iso}</b></div><div class="summary-cell"><small>ЗАГОТОВКА</small><b>Ø${round(s.diameter,1)} × ${round(s.length,1)} мм</b></div><div class="summary-cell"><small>СТРАТЕГИЯ</small><b>${{safe:'Безопасная',work:'Рабочая',productive:'Производительная'}[state.strategy]}</b></div><div class="summary-cell"><small>ПРОВЕРЕНО</small><b>${verifiedCount()} / ${totalPassCount()} проходов</b></div>`;
  $('#resultsList').innerHTML=state.results.map((group,i)=>{const op=operation(group.opId),allOk=group.passes.every(p=>p.verified);return `<article class="result-card glass iso-tint" data-iso="${m.iso}"><div class="result-card-header"><div class="op-number"><b>${String(i+1).padStart(2,'0')}</b></div><div><h3>${op.icon} ${op.name}</h3><p>${state.route.find(x=>x.uid===group.routeUid)?.pass==='both'?'Черновая + чистовая':passLabel(group.passes[0].pass)} · ${group.passes.length} расчёт(а)</p></div><span class="verified-pill ${allOk?'ok':''}">${allOk?'✓ ПРОВЕРЕНО':'НЕ ПРОВЕРЕНО'}</span></div><div class="result-card-body">${group.passes.map((p,j)=>resultPassHtml(p,j)).join('')}</div></article>`}).join('');
  $$('[data-anim]').forEach(el=>animateNumber(el,+el.dataset.anim,+el.dataset.dec));
  $$('[data-feedback]').forEach(b=>b.addEventListener('click',()=>feedbackAction(b.dataset.pass,b.dataset.feedback)));
  if(animate)syncHeroLive(firstResultPass(),true);else if(state.results.length)syncHeroLive(firstResultPass(),false)
}
function totalPassCount(){return state.results.reduce((a,g)=>a+g.passes.length,0)}function verifiedCount(){return state.results.reduce((a,g)=>a+g.passes.filter(p=>p.verified).length,0)}
function getPassById(id){for(const g of state.results){const p=g.passes.find(x=>x.id===id);if(p)return p}return null}
function feedbackAction(passId,ruleId){const p=getPassById(passId),rule=D.feedbackRules[ruleId];if(!p)return;if(ruleId==='good'){p.verified=true;p.lastFeedback='good';p.verifiedAt=new Date().toISOString();renderResults();syncHeroLive(p,true);toast('Режим этой операции подтверждён');return}
  p.lastFeedback=ruleId;const proposed=deep(p);proposed.rpm=round(p.rpm*rule.mult.rpm);proposed.f=round(p.opId.startsWith('thread')?p.f:clamp(p.f*rule.mult.f,p.range.f[0],p.range.f[2]),3);proposed.ap=round(clamp(p.ap*rule.mult.ap,Math.min(.05,p.range.ap[0]),p.range.ap[2]),3);proposed.vc=round(Math.PI*p.diameter*proposed.rpm/1000,1);proposed.targetVc=proposed.vc;proposed.power=round(p.power*rule.mult.f*rule.mult.ap*rule.mult.rpm,2);proposed.powerPct=round(proposed.power/state.machine.spindleKw*100);proposed.trial={rpm:round(proposed.rpm*.92),f:round(proposed.opId.startsWith('thread')?proposed.f:proposed.f*.88,3),ap:round(proposed.ap*.62,3),vc:round(Math.PI*p.diameter*(proposed.rpm*.92)/1000,1)};
  const host=$(`#adjust-${cssSafe(passId)}`);host.innerHTML=`<div class="adjust-panel"><h5>${rule.icon} ${rule.label}</h5><p>${rule.reason}</p><div class="adjust-compare"><div><small>S, об/мин</small><del>${p.rpm}</del><b>${proposed.rpm}</b></div><div><small>f, мм/об</small><del>${p.f}</del><b>${proposed.f}</b></div><div><small>ap, мм</small><del>${p.ap}</del><b>${proposed.ap}</b></div><div><small>Vc, м/мин</small><del>${p.vc}</del><b>${proposed.vc}</b></div></div><div class="adjust-actions"><button class="primary" data-apply-adjust="${passId}">Применить новый режим</button><button class="ghost" data-cancel-adjust="${passId}">Отмена</button></div></div>`;
  host.querySelector('[data-apply-adjust]').addEventListener('click',()=>{Object.assign(p,proposed,{verified:false,revision:p.revision+1});renderResults();syncHeroLive(p,true);toast('Пересчитано. Сделай новый пробный проход')});host.querySelector('[data-cancel-adjust]').addEventListener('click',()=>host.innerHTML='');
}

function projectPayload(){return{id:state.projectId||uid(),name:$('#projectName').value.trim()||'Без названия',savedAt:new Date().toISOString(),machine:deep(state.machine),materialId:state.materialId,stock:deep(state.stock),route:deep(state.route),selectedToolIds:deep(state.selectedToolIds||[]),requirements:deep(state.requirements||[]),strategy:state.strategy,coolant:state.coolant,rigidity:state.rigidity,results:deep(state.results),version:D.version}}
function saveCurrentProject(){if(!state.results.length){toast('Сначала рассчитай маршрут');return}const p=projectPayload(),list=projects(),idx=list.findIndex(x=>x.id===p.id);if(idx>=0)list[idx]=p;else list.unshift(p);state.projectId=p.id;saveProjects(list.slice(0,120));toast('Проект сохранён локально')}
['saveProjectBtn','saveProjectTop'].forEach(id=>$('#'+id).addEventListener('click',saveCurrentProject));
function openProject(id){const p=projects().find(x=>x.id===id);if(!p)return;state.projectId=p.id;state.machine=p.machine||state.machine;state.materialId=p.materialId;state.stock=p.stock;state.route=p.route||[];state.selectedToolIds=p.selectedToolIds||[];state.requirements=p.requirements||[];state.strategy=p.strategy||'work';state.coolant=p.coolant||'emulsion';state.rigidity=p.rigidity||'medium';state.results=p.results||[];$('#projectName').value=p.name;syncMachineUI();renderMaterials();syncStockUI();renderRoute();syncStrategy();renderRequirements();renderResults();navView('work');goStep(state.results.length?5:3);toast('Проект показан') }
function deleteProject(id){if(!confirm('Удалить проект с этого устройства?'))return;markProjectSync(id,true);saveProjects(projects().filter(x=>x.id!==id));toast('Проект удалён и помечен для синхронизации')}
function renderProjects(){const list=projects(),box=$('#projectsList');if(!list.length){box.innerHTML='<div class="empty-state glass"><b>Проектов пока нет</b><span>Рассчитай техпроцесс и сохрани его — он появится здесь.</span></div>';return}box.innerHTML=list.map(p=>{const m=D.materials.find(x=>x.id===p.materialId),s=p.stock,verified=(p.results||[]).reduce((a,g)=>a+g.passes.filter(x=>x.verified).length,0),total=(p.results||[]).reduce((a,g)=>a+g.passes.length,0);return `<article class="project-card glass"><div><h3>${esc(p.name)}</h3><p>${new Date(p.savedAt).toLocaleString('ru-RU')} · ${m?.name||p.materialId}</p><div class="project-meta"><span>Ø${s.diameter}${s.unit}</span><span>${s.length}${s.unit}</span><span>${p.route?.length||0} операций</span><span>${verified}/${total} проверено</span></div></div><div class="project-actions"><button data-open-project="${p.id}">Показать</button><button data-delete-project="${p.id}">Удалить</button></div></article>`}).join('');box.querySelectorAll('[data-open-project]').forEach(b=>b.addEventListener('click',()=>openProject(b.dataset.openProject)));box.querySelectorAll('[data-delete-project]').forEach(b=>b.addEventListener('click',()=>deleteProject(b.dataset.deleteProject)))}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

function clearToolPurposeChecks(selector='#customOps'){$$(selector+' input').forEach(x=>x.checked=false)}
function newProject(){if(state.route.length||state.results.length){if(!confirm('Начать новый проект? Несохранённые данные будут сброшены.'))return}state.projectId=null;state.materialId='aisi304';state.stock={diameter:50,length:100,unit:'mm',hardness:180};state.route=[];state.selectedToolIds=[];state.requirements=[];state.strategy='work';state.coolant='emulsion';state.rigidity='medium';state.results=[];$('#projectName').value='Новая деталь';clearToolPurposeChecks('#customOps');clearToolPurposeChecks('#scanOps');store.set(KEYS.draft,null);renderMaterials();syncStockUI();renderRoute();renderRequirements();syncStrategy();syncHeroLive(null,false);goStep(1);toast('Новый проект')}
$('#resetDraft').addEventListener('click',newProject);$('#newProjectBtn').addEventListener('click',newProject);

function printProject(){if(!state.results.length){toast('Нет рассчитанного проекта');return}window.print()}
['printProjectBtn','printProjectTop'].forEach(id=>$('#'+id).addEventListener('click',printProject));
function exportPng(){if(!state.results.length){toast('Нет рассчитанного проекта');return}const c=$('#exportCanvas'),ctx=c.getContext('2d'),w=c.width,h=c.height;const grad=ctx.createLinearGradient(0,0,w,h);grad.addColorStop(0,'#071624');grad.addColorStop(1,'#04080d');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);ctx.fillStyle='#6bbaff';ctx.font='700 26px system-ui';ctx.fillText('CNC COPILOT · FULL 3.0.3',70,80);ctx.fillStyle='#f7fbff';ctx.font='800 56px system-ui';ctx.fillText($('#projectName').value||'Техпроцесс',70,155);const s=stockMm(),m=material();ctx.fillStyle='#9db0c0';ctx.font='26px system-ui';ctx.fillText(`${state.machine.name} · ${m.name} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм`,70,210);let y=285;state.results.slice(0,9).forEach((g,i)=>{ctx.fillStyle='rgba(255,255,255,.07)';roundRect(ctx,60,y-38,1080,125,25);ctx.fill();ctx.fillStyle='#f7fbff';ctx.font='700 28px system-ui';ctx.fillText(`${String(i+1).padStart(2,'0')}  ${operation(g.opId).name}`,85,y);let x=85;g.passes.forEach((p,j)=>{ctx.fillStyle=j?'#86e2b2':'#8fcaff';ctx.font='600 20px system-ui';ctx.fillText(`${passLabel(p.pass)}: S ${p.rpm}  f ${p.f}  Vc ${p.vc}  ap ${p.ap}${p.verified?'  ✓':''}`,x,y+42+j*31)});y+=145});ctx.fillStyle='#71879a';ctx.font='18px system-ui';ctx.fillText('Стартовая технологическая рекомендация. Проверяй зажим, траекторию, нули и лимиты станка.',70,h-70);c.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`CNC-${safeName($('#projectName').value)}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)},'image/png')}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):(ctx.rect(x,y,w,h));}
function safeName(s){return String(s||'project').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g,'_').slice(0,60)}
$('#exportPngBtn').addEventListener('click',exportPng);

function toolLibraryCardHtml(t){return `<article class="tool-card-ui glass iso-tint ${t.libraryType==='cupboard'?'mine':''}" data-iso="${t.iso?.[0]||'P'}"><div class="tool-art real-tool-art">${toolThumbHtml(t,t.id)}${toolSideThumb(t)}</div><div class="tool-card-copy"><div class="tool-card-top"><span class="badge ${t.libraryType==='cupboard'?'green':''}">${t.libraryType==='cupboard'?'МОЙ ШКАФ':'КАТАЛОГ'}</span>${t.libraryType==='cupboard'?`<span class="stock-pill">${esc(t.location||'без ячейки')} · ${t.quantity||0} шт.</span>`:''}</div><h3>${esc(t.holder||'Державка не указана')}</h3><p><b>${esc(t.insert)}</b> · ${esc(t.grade)} · ${esc(t.breaker)} · ${noseLabel(t)}</p><div class="tool-tags"><span>ISO ${(t.iso||[]).join('/')}</span><span>${esc(toolUseText(t))}</span></div>${isoDotsHtml(t)}${t.libraryType==='cupboard'?`<div class="tool-local-actions"><button data-tool-qty="${t.id}" data-delta="1">+1</button><button data-tool-qty="${t.id}" data-delta="-1">−1</button><button data-tool-delete="${t.id}">Удалить</button></div>`:''}</div></article>`}
function renderTools(){
  const q=($('#toolSearch')?.value||'').trim().toLowerCase(),iso=$('#toolIsoFilter')?.value||'all';
  const filter=t=>(iso==='all'||t.iso.includes(iso))&&(!q||[t.holder,t.insert,t.grade,t.breaker,t.location,t.manufacturer].join(' ').toLowerCase().includes(q));
  const mine=cupboardTools().filter(filter),catalog=D.tools.map(t=>({...t,libraryType:'catalog',quantity:t.quantity||null,location:t.location||'',photos:t.photos||{}})).filter(filter);
  const mineHost=$('#toolLibraryMine'),catalogHost=$('#toolLibraryCatalog');
  if(mineHost)mineHost.innerHTML=mine.length?mine.map(toolLibraryCardHtml).join(''):'<div class="empty-state glass tool-empty"><b>Мой шкаф пока пуст</b><span>Отсканируй коробку или добавь инструмент вручную. Каталог ниже останется только запасным источником.</span></div>';
  if(catalogHost)catalogHost.innerHTML=catalog.length?catalog.map(toolLibraryCardHtml).join(''):'<div class="empty-state glass tool-empty"><b>В каталоге ничего не найдено</b><span>Измени поиск или ISO-фильтр.</span></div>';
  const mineCount=$('#toolMineCount'),catalogCount=$('#toolCatalogCount');if(mineCount)mineCount.textContent=`${mine.length} позиций`;if(catalogCount)catalogCount.textContent=`${catalog.length} позиций`;
  $$('[data-tool-qty]').forEach(b=>b.addEventListener('click',()=>{const list=cupboardTools(),t=list.find(x=>x.id===b.dataset.toolQty);if(!t)return;t.quantity=Math.max(0,(t.quantity||0)+(+b.dataset.delta));saveCupboard(list);toast(`${t.insert}: ${t.quantity} шт.`)}));
  $$('[data-tool-delete]').forEach(b=>b.addEventListener('click',()=>{const t=cupboardTools().find(x=>x.id===b.dataset.toolDelete);if(!t)return;if(!confirm(`Удалить ${t.insert} из шкафа?`))return;state.selectedToolIds=(state.selectedToolIds||[]).filter(x=>x!==t.id);markToolSync(t,true);saveCupboard(cupboardTools().filter(x=>x.id!==t.id));toast('Инструмент удалён и помечен для синхронизации')}));
}
$('#toolSearch')?.addEventListener('input',renderTools);$('#toolIsoFilter')?.addEventListener('change',renderTools);

async function compressImage(file,maxSide=900,quality=.72){return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale)),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);URL.revokeObjectURL(url);resolve(c.toDataURL('image/jpeg',quality))};img.onerror=e=>{URL.revokeObjectURL(url);reject(e)};img.src=url})}
async function filePhoto(id){const f=$('#'+id)?.files?.[0];return f?compressImage(f,760,.68):''}
$('#addCustomTool').addEventListener('click',async()=>{const holder=$('#customHolder').value.trim(),insert=$('#customInsert').value.trim();if(!insert){toast('Укажи маркировку пластины');return}const ops=$$('#customOps input:checked').map(x=>x.value);const front=await filePhoto('customPhotoFront'),side=await filePhoto('customPhotoSide');const tool=normalizeTool({id:'custom-'+uid(),holder:holder||'Державка не указана',insert,grade:$('#customGrade').value.trim()||'не задан',breaker:$('#customBreaker').value.trim()||'—',nose:+$('#customNose').value||.8,iso:[$('#customIso').value],isoPriority:{[$('#customIso').value]:'primary'},ops,passes:['rough','finish','single'],source:'Добавлено вручную',verified:true,quantity:+$('#customQuantity').value||1,location:$('#customLocation').value.trim(),libraryType:'cupboard',photos:{front,side},art:{shape:shapeFromInsert(insert),tone:'steel'}});const list=cupboardTools();const dup=list.find(x=>x.canonicalKey===tool.canonicalKey);if(dup){dup.quantity+=(tool.quantity||1);if(!dup.photos?.front&&front)dup.photos.front=front;if(!dup.photos?.side&&side)dup.photos.side=side;if(saveCupboard(list))toast(`Уже было в ${dup.location||'шкафу'} · количество ${dup.quantity}`);return}list.push(tool);if(saveCupboard(list)){clearToolPurposeChecks();toast('Инструмент добавлен в локальный шкаф')}});

let scannerImages=[],scannerStoredImages=[],scannerDuplicateId=null,scannerForceNew=false,scannerAnalysis={};
function openScanner(){scannerImages=[];scannerStoredImages=[];scannerDuplicateId=null;scannerForceNew=false;scannerAnalysis={};$('#scanPreview').innerHTML='<div class="scan-empty"><span>⌾</span><b>Добавь фото коробки</b><small>Родная коробка — обычно достаточно этикетки. Если есть сомнение, добавь лицо и торец пластинки.</small></div>';$('#scanForm').classList.add('hidden');$('#scanDuplicate').classList.add('hidden');setScanStatus('Готов к сканированию','ready');$('#scannerModal').classList.remove('hidden');$('#scannerModal').setAttribute('aria-hidden','false');document.body.classList.add('modal-open')}
function closeScanner(){$('#scannerModal').classList.add('hidden');$('#scannerModal').setAttribute('aria-hidden','true');document.body.classList.remove('modal-open')}
$('#openScanner')?.addEventListener('click',openScanner);$('#closeScanner')?.addEventListener('click',closeScanner);$('#scannerModal')?.addEventListener('click',e=>{if(e.target.id==='scannerModal')closeScanner()});
function setScanStatus(text,mode='ready'){const el=$('#scanStatus');el.dataset.mode=mode;el.querySelector('span').textContent=text}
async function scannerFilesSelected(files){const arr=[...files].slice(0,4);scannerImages=[];scannerStoredImages=[];setScanStatus('Готовлю изображения…','working');for(const f of arr){try{const [ai,small]=await Promise.all([compressImage(f,1800,.84),compressImage(f,760,.64)]);scannerImages.push(ai);scannerStoredImages.push(small)}catch{}}renderScanPreview();setScanStatus(scannerImages.length?`${scannerImages.length} фото готово к распознаванию`:'Не удалось прочитать фото',scannerImages.length?'ready':'error')}
$('#scannerCamera')?.addEventListener('change',e=>scannerFilesSelected(e.target.files));$('#scannerGallery')?.addEventListener('change',e=>scannerFilesSelected(e.target.files));
function renderScanPreview(){$('#scanPreview').innerHTML=scannerImages.length?scannerImages.map((src,i)=>`<div class="scan-shot"><img src="${src}" alt="Фото ${i+1}"><small>${i===0?'коробка/этикетка':i===1?'лицо пластинки':i===2?'торец пластинки':'доп. фото'}</small></div>`).join(''):'<div class="scan-empty"><span>⌾</span><b>Фото не выбраны</b></div>'}
function parseToolText(text=''){const up=text.toUpperCase(),insert=(up.match(/\b(?:W|D|C|T|V|S|R|M)[CNPGDA][A-Z]{1,2}\s*\d{4,6}(?:[- ][A-Z0-9]{1,5})?/i)||up.match(/\bMGMN\s*\d{3,4}(?:[- ][A-Z0-9]{1,5})?/i)||[])[0]||'',r=(up.match(/R\s*([0-9]+(?:[.,][0-9]+)?)/)||[])[1],grades=(up.match(/\b(?:PT|PC|CT|GC|KC|IC|VP|TN|CP|PR|AC|TT|MC)\d{3,5}[A-Z]*\b/g)||[]);return {manufacturer:'',insert:insert.trim(),grade:grades[0]||'',breaker:(insert.split('-')[1]||''),nose:r?+r.replace(',','.'):null,iso:[],operations:[],confidence:.35,evidence:text}}
async function nativeTextScan(){if(!('TextDetector'in window)||!scannerImages.length)return null;try{const det=new TextDetector(),img=new Image();img.src=scannerImages[0];await img.decode();const bmp=await createImageBitmap(img),blocks=await det.detect(bmp);return parseToolText(blocks.map(b=>b.rawValue).join('\n'))}catch{return null}}
function scanPayloadToForm(d){d=d||{};scannerAnalysis=d;$('#scanManufacturer').value=d.manufacturer||'';$('#scanInsert').value=d.insert||d.designation||'';$('#scanGrade').value=d.grade||'';$('#scanBreaker').value=d.breaker||d.chipbreaker||'';$('#scanNose').value=d.nose_radius_mm??d.nose??'';$('#scanQuantity').value=d.quantity||1;$('#scanLocation').value=d.location||'';$('#scanHolder').value=d.holder||d.holder_compatibility||'';$('#scanEvidence').value=[d.evidence,d.notes,Number.isFinite(+d.confidence)?`Уверенность: ${Math.round(+d.confidence*100)}%`:null].filter(Boolean).join('\n');const groups=[...(d.iso||d.material_groups||[])];Object.entries(d.iso_priority||{}).forEach(([k,v])=>{if(v&&v!=='off')groups.push(k)});const iso=new Set(groups.map(x=>String(x).toUpperCase()));$$('#scanForm .iso-scan-row input').forEach(x=>x.checked=iso.has(x.value));const ops=new Set((d.operations||[]).map(String));$$('#scanOps input').forEach(x=>x.checked=ops.has(x.value));$('#scanForm').classList.remove('hidden');checkScannerDuplicate()}
function scanFormTool(){const iso=$$('#scanForm .iso-scan-row input:checked').map(x=>x.value),ops=$$('#scanOps input:checked').map(x=>x.value),insert=$('#scanInsert').value.trim(),noseRaw=$('#scanNose').value.trim();return normalizeTool({id:'scan-'+uid(),manufacturer:$('#scanManufacturer').value.trim(),holder:$('#scanHolder').value.trim()||'Державка не указана',insert,grade:$('#scanGrade').value.trim(),breaker:$('#scanBreaker').value.trim(),nose:noseRaw===''?'':+noseRaw,iso,isoPriority:scannerAnalysis.iso_priority||{},ops,passes:['rough','finish','single'],quantity:+$('#scanQuantity').value||1,location:$('#scanLocation').value.trim(),source:'ИИ-сканер · подтверждено пользователем',verified:true,libraryType:'cupboard',photos:{box:scannerStoredImages[0]||'',front:scannerStoredImages[1]||'',side:scannerStoredImages[2]||''},art:{shape:shapeFromInsert(insert),tone:'steel'}})}
function checkScannerDuplicate(){const tool=scanFormTool(),dup=cupboardTools().find(x=>x.canonicalKey===tool.canonicalKey);scannerDuplicateId=dup?.id||null;scannerForceNew=false;const box=$('#scanDuplicate');if(!dup){box.classList.add('hidden');$('#saveScannedTool').textContent='Подтвердить и добавить';return}box.classList.remove('hidden');box.innerHTML=`<div><b>Такая пластинка уже есть</b><span>${esc(dup.insert)} · ${esc(dup.grade)} · ${esc(dup.breaker)}<br>${esc(dup.location||'ячейка не задана')} · ${dup.quantity||0} шт.</span></div><button id="forceSeparateTool" type="button">Это другая</button>`;$('#saveScannedTool').textContent='Добавить количество к существующей';$('#forceSeparateTool').addEventListener('click',()=>{scannerForceNew=true;scannerDuplicateId=null;box.innerHTML='<div><b>Будет создана отдельная карточка</b><span>Проверь маркировку и ячейку перед сохранением.</span></div>';$('#saveScannedTool').textContent='Создать отдельную карточку'})}
['scanInsert','scanGrade','scanBreaker','scanNose'].forEach(id=>$('#'+id)?.addEventListener('input',checkScannerDuplicate));
$('#runScanner')?.addEventListener('click',async()=>{if(!scannerImages.length){toast('Сначала добавь фото');return}setScanStatus('ИИ читает маркировку и сверяет поля…','working');$('#runScanner').disabled=true;try{let r=await fetch('./api/scan-insert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images:scannerImages,mode:'strict_insert_scan'})});if(!r.ok)throw new Error(await r.text());const d=await r.json();scanPayloadToForm(d);setScanStatus('Распознавание готово · проверь карточку','done')}catch(err){const local=await nativeTextScan();if(local){scanPayloadToForm(local);setScanStatus('Использовано локальное распознавание текста браузером · обязательно проверь поля','warn')}else{scanPayloadToForm({iso:[],operations:[],evidence:'Сервер распознавания недоступен. Фото сохранены; заполни маркировку вручную и подтверди. Для ИИ-сканирования настрой сервер и переменную OPENAI_API_KEY.'});setScanStatus('ИИ-распознавание недоступно · ручное подтверждение','error')}}finally{$('#runScanner').disabled=false}});
$('#saveScannedTool')?.addEventListener('click',()=>{const tool=scanFormTool();if(!tool.insert){toast('Маркировка пластины не распознана');return}const list=cupboardTools();if(scannerDuplicateId&&!scannerForceNew){const dup=list.find(x=>x.id===scannerDuplicateId);if(dup){dup.quantity=(dup.quantity||0)+(tool.quantity||1);dup.location=dup.location||tool.location;dup.photos=dup.photos||{};['box','front','side'].forEach(k=>{if(!dup.photos[k]&&tool.photos[k])dup.photos[k]=tool.photos[k]});if(saveCupboard(list)){closeScanner();toast(`Уже есть · теперь ${dup.quantity} шт. в ${dup.location||'шкафу'}`)}return}}tool.canonicalKey=canonicalToolKey(tool);list.push(tool);if(saveCupboard(list)){closeScanner();toast('Пластинка добавлена в мой шкаф')}});
$('#scanAgain')?.addEventListener('click',openScanner);

const sizeSteps=[[1,3],[3,6],[6,10],[10,18],[18,30],[30,50],[50,80],[80,120],[120,180],[180,250],[250,315],[315,400],[400,500]];const itMul={5:7,6:10,7:16,8:25,9:40,10:64,11:100,12:160,13:250,14:400};
function itTol(n,g){const st=sizeSteps.find(([a,b])=>n>a&&n<=b)||sizeSteps.find(([a,b])=>n>=a&&n<=b);if(!st)return null;const dm=Math.sqrt(st[0]*st[1]),i=.45*Math.cbrt(dm)+.001*dm;return itMul[g]*i/1000}
function limitsFor(n,letter,grade){const t=itTol(n,grade);if(t==null)return null;let lo=0,hi=0;if(letter==='H'){lo=0;hi=t}else if(letter==='h'){lo=-t;hi=0}else{lo=-t/2;hi=t/2}return{t,lo,hi}}
function shaftDeviation(n,letter,grade){const t=itTol(n,grade);if(t==null)return null;const D=n;let es=0,ei=0;if(letter==='h'){es=0;ei=-t}else if(letter==='g'){es=(-2.5*Math.pow(D,.34))/1000;ei=es-t}else if(letter==='f'){es=(-5.5*Math.pow(D,.41))/1000;ei=es-t}else if(letter==='k'){ei=(2.0*Math.pow(D,.20))/1000;es=ei+t}else if(letter==='p'){ei=(16*Math.pow(D,.44))/1000;es=ei+t}else{ei=-t/2;es=t/2}return{t,lo:ei,hi:es}}
function renderRequirementBuilder(){
  const opSel=$('#reqOperation');if(opSel){const cur=opSel.value||'all';opSel.innerHTML='<option value="all">Вся деталь / авто</option>'+D.operations.map(o=>`<option value="${o.id}">${o.name}</option>`).join('');opSel.value=[...opSel.options].some(o=>o.value===cur)?cur:'all'}
  const type=$('#reqType')?.value||'tolerance',host=$('#reqDynamic');if(!host)return;
  if(type==='tolerance')host.innerHTML=`<div class="fields two"><label class="field">Поле допуска<select id="reqZone"><option>H</option><option>h</option><option>JS</option><option>js</option></select></label><label class="field">Квалитет<select id="reqGrade">${[5,6,7,8,9,10,11,12,13,14].map(g=>`<option ${g===7?'selected':''}>${g}</option>`).join('')}</select></label></div><p class="muted compact">Для точных размеров IT5–IT8 Copilot отмечает обязательный чистовой контроль и мягче выбирает финишную подачу/глубину.</p>`;
  else if(type==='fit')host.innerHTML=`<label class="field">Посадка<select id="reqFit">${D.fitPresets.map((x,i)=>`<option value="${i}">${x.name}</option>`).join('')}</select></label>`;
  else if(type==='thread'){host.innerHTML=`<div class="fields three"><label class="field">Резьба<select id="reqThread">${D.threads.map(([n,p])=>`<option value="${n}" data-p="${p}">${n} × ${p}</option>`).join('')}</select></label><label class="field">Шаг P, мм<input id="reqThreadPitch" type="number" step="0.05" value="0.5"></label><label class="field">Класс допуска<select id="reqThreadClass"><option>6H</option><option>6g</option><option>7H</option><option>6e</option></select></label></div>`;const rs=$('#reqThread'),rp=$('#reqThreadPitch');const sync=()=>rp.value=rs.selectedOptions[0]?.dataset.p||rp.value;rs.addEventListener('change',sync);sync()}
  else host.innerHTML='<label class="field">Требование<input id="reqManualText" placeholder="например Ø24.98…25.00 после чистовой"></label>';
}
function renderRequirements(){
  const list=state.requirements||[],box=$('#requirementsList');if(box)box.innerHTML=list.length?list.map(r=>`<div class="requirement-item iso-tint" data-iso="${material().iso}"><div><b>${esc(requirementLabel(r))}</b><span>${r.operation==='all'?'вся деталь':opLabel(r.operation)}${r.target!=null?` · цель ${Number(r.target).toFixed(4)} мм`:''}</span></div><button data-remove-req="${r.id}" title="Удалить">×</button></div>`).join(''):'<div class="empty-mini">Для этой детали требования пока не выбраны.</div>';
  $$('[data-remove-req]').forEach(b=>b.addEventListener('click',()=>{state.requirements=state.requirements.filter(r=>r.id!==b.dataset.removeReq);renderRequirements();renderRoute();renderPreflight();saveDraft()}));
  const strip=$('#activeReqStrip');if(strip){strip.querySelector('b').textContent=list.length?`${list.length}: ${list.slice(0,2).map(requirementLabel).join(' · ')}${list.length>2?'…':''}`:'не заданы'}
}
$('#reqType')?.addEventListener('change',renderRequirementBuilder);
$('#addRequirement')?.addEventListener('click',()=>{const type=$('#reqType').value,nominal=+$('#reqNominal').value||0,operation=$('#reqOperation').value;let r={id:'req-'+uid(),type,nominal,operation};
  if(type==='tolerance'){r.zone=$('#reqZone').value;r.grade=+$('#reqGrade').value;const lim=limitsFor(nominal,r.zone,r.grade);if(lim){r.lo=lim.lo;r.hi=lim.hi;r.target=nominal+(lim.lo+lim.hi)/2}}
  else if(type==='fit'){const p=D.fitPresets[+$('#reqFit').value||0];Object.assign(r,{fit:+$('#reqFit').value,fitName:p.name,hole:p.hole,holeGrade:p.holeGrade,shaft:p.shaft,shaftGrade:p.shaftGrade,target:nominal})}
  else if(type==='thread'){const sel=$('#reqThread');const threadDia=+String(sel.value).slice(1)||nominal;r.nominal=threadDia;r.thread=sel.value;r.pitch=+$('#reqThreadPitch').value||+sel.selectedOptions[0]?.dataset.p;r.threadClass=$('#reqThreadClass').value;r.target=threadDia;r.thread=`${r.thread} × ${r.pitch}`}
  else {r.text=$('#reqManualText').value.trim();if(!r.text){toast('Впиши требование');return}}
  state.requirements.push(r);renderRequirements();renderRoute();renderPreflight();saveDraft();toast('Требование добавлено к детали')
});

function renderReference(){const fs=$('#fitPreset');fs.innerHTML=D.fitPresets.map((x,i)=>`<option value="${i}">${x.name}</option>`).join('');const th=$('#threadSelect');th.innerHTML=D.threads.map(([n,p])=>`<option value="${n}" data-p="${p}">${n} × ${p}</option>`).join('');th.value='M16';$('#threadPitchRef').value=2;renderRequirementBuilder();renderRequirements();calcTol();calcFit();calcThread()}
function calcTol(){const n=+$('#tolNom').value,g=+$('#tolGrade').value,l=$('#tolLetter').value,r=limitsFor(n,l,g);if(!r){$('#tolResult').textContent='Диапазон встроенного расчёта: 1–500 мм.';return}$('#tolResult').innerHTML=`<b>${n} ${l}${g}</b><br>IT${g}: <b>${(r.t*1000).toFixed(1)} мкм</b><br>Отклонения: ${r.lo>=0?'+':''}${r.lo.toFixed(4)} / ${r.hi>=0?'+':''}${r.hi.toFixed(4)} мм<br>Предельный размер: <b>${(n+r.lo).toFixed(4)} … ${(n+r.hi).toFixed(4)} мм</b>`}
function calcFit(){const n=+$('#fitNom').value,p=D.fitPresets[+$('#fitPreset').value||0],hole=limitsFor(n,p.hole,p.holeGrade),shaft=shaftDeviation(n,p.shaft,p.shaftGrade);if(!hole||!shaft){$('#fitResult').textContent='Номинал вне диапазона 1–500 мм.';return}const minClear=(n+hole.lo)-(n+shaft.hi),maxClear=(n+hole.hi)-(n+shaft.lo);$('#fitResult').innerHTML=`<b>${p.hole}${p.holeGrade}/${p.shaft}${p.shaftGrade}</b><br>Отверстие: ${(n+hole.lo).toFixed(4)} … ${(n+hole.hi).toFixed(4)} мм<br>Вал: ${(n+shaft.lo).toFixed(4)} … ${(n+shaft.hi).toFixed(4)} мм<br>Зазор/натяг: <b>${(minClear*1000).toFixed(1)} … ${(maxClear*1000).toFixed(1)} мкм</b><br><span class="muted">Для полей g/f/k/p фундаментальное отклонение здесь — встроенный справочный помощник. Ответственную посадку сверяй с актуальной таблицей ISO 286.</span>`}
function calcThread(){const n=$('#threadSelect').value,p=+$('#threadPitchRef').value,d=+n.slice(1),drill=d-p,depth=.6134*p;$('#threadResult').innerHTML=`<b>${n} × ${p}</b><br>Сверло под метчик, ориентир D−P: <b>Ø${drill.toFixed(2)} мм</b><br>Радиальная глубина профиля наружной метрической резьбы, ориентир: <b>${depth.toFixed(3)} мм</b>`}
$('#calcTolerance').addEventListener('click',calcTol);$('#calcFit').addEventListener('click',calcFit);$('#calcThread').addEventListener('click',calcThread);$('#threadSelect').addEventListener('change',()=>{$('#threadPitchRef').value=$('#threadSelect').selectedOptions[0].dataset.p;calcThread()});

function authorMail(type='general'){
  const subjects={general:'CNC Copilot — обратная связь',bug:'CNC Copilot — ошибка',idea:'CNC Copilot — предложение функции',cut:'CNC Copilot — режим резания',ui:'CNC Copilot — интерфейс'};
  const body=`Здравствуйте, Иван!%0D%0A%0D%0AВерсия: ${encodeURIComponent(D.version)}%0D%0AРаздел: ${encodeURIComponent(type)}%0D%0A%0D%0AСообщение:%0D%0A`;
  return `mailto:${D.author.email}?subject=${encodeURIComponent(subjects[type]||subjects.general)}&body=${body}`;
}
$('#authorMail').href=authorMail();$$('[data-mail-type]').forEach(b=>b.addEventListener('click',()=>{location.href=authorMail(b.dataset.mailType)}));

$('#exportBackup').addEventListener('click',()=>{const data={version:D.version,exportedAt:new Date().toISOString(),machine:state.machine,customTools:store.get(KEYS.tools,[]),projects:projects()};downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'CNC-Copilot-backup.json')});
$('#importBackup').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const data=JSON.parse(rd.result);if(data.machine){state.machine=data.machine;store.set(KEYS.machine,data.machine)}if(Array.isArray(data.customTools))store.set(KEYS.tools,data.customTools);if(Array.isArray(data.projects))store.set(KEYS.projects,data.projects);syncMachineUI();renderTools();renderProjects();toast('Резервная копия импортирована')}catch{toast('Не удалось прочитать JSON')}};rd.readAsText(f)});
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),600)}

function syncStrategy(){$$('#strategySwitch [data-strategy]').forEach(b=>b.classList.toggle('active',b.dataset.strategy===state.strategy));$('#coolant').value=state.coolant;$('#rigidity').value=state.rigidity}
function initOfflineStatus(){const label=$('#offlineLabel');if(label)label.textContent='ЛОКАЛЬНОЕ ЯДРО · ГОТОВО'}
function registerSW(){if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).catch(()=>{}))}
window.CNC_APP={
  toast,
  getSyncPayload(){return {version:'3.0.3',machine:store.get(KEYS.machine,state.machine),tools:store.get(KEYS.tools,[]),projects:store.get(KEYS.projects,[]),draft:store.get(KEYS.draft,null),syncMarks:store.get(KEYS.syncMarks,{tools:{},projects:{}}),updatedAt:new Date().toISOString()}},
  applySyncPayload(payload={}){
    try{
      if(payload.machine){localStorage.setItem(KEYS.machine,JSON.stringify(payload.machine));state.machine=deep(payload.machine)}
      if(Array.isArray(payload.tools))localStorage.setItem(KEYS.tools,JSON.stringify(payload.tools));
      if(Array.isArray(payload.projects))localStorage.setItem(KEYS.projects,JSON.stringify(payload.projects));
      if(payload.syncMarks&&typeof payload.syncMarks==='object')localStorage.setItem(KEYS.syncMarks,JSON.stringify(payload.syncMarks));
    }catch(e){console.warn('CNC sync apply failed',e)}
    syncMachineUI();renderTools();renderProjects();renderRoute();renderProcessToolTray();
  }
};

function init(){initTheme();initAdaptiveDock();syncMachineUI();renderMaterials();syncStockUI();renderOperationCatalog();renderRoute();syncStrategy();renderPreflight();renderTools();renderProjects();renderReference();initOfflineStatus();syncHeroLive(firstResultPass(),false);goStep(state.step||1,false);registerSW();}
init();
})();
