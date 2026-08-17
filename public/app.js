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

function normalizeMachineProfile(raw){
  const base=deep(D.machineDefault),src=(raw&&typeof raw==='object')?raw:{};
  const merged={...base,...src,motor:{...(base.motor||{}),...(src.motor||{})},drive:{...(base.drive||{}),...(src.drive||{})},chuckCylinder:{...(base.chuckCylinder||{}),...(src.chuckCylinder||{})}};
  // FULL 3.0.6 shipped with an 11 kW placeholder. Upgrade only legacy profiles that do not know the verified hardware revision.
  if(!src.profileRevision||src.profileRevision<base.profileRevision){
    if(!Number.isFinite(+src.spindleKw)||+src.spindleKw===11)merged.spindleKw=base.spindleKw;
    merged.profileRevision=base.profileRevision;merged.verifiedProfile=base.verifiedProfile;merged.profileSource=base.profileSource;
    merged.motor=deep(base.motor);merged.drive=deep(base.drive);merged.chuckCylinder=deep(base.chuckCylinder);merged.powerPolicy=base.powerPolicy;merged.powerNote=base.powerNote;
  }
  return merged;
}
const state={
  view:'work',step:1,
  machine:normalizeMachineProfile(store.get(KEYS.machine,deep(D.machineDefault))),
  materialId:'',
  stock:{diameter:null,length:null,unit:'mm',hardness:null},
  route:[],selectedToolIds:[],requirements:[],strategy:'work',coolant:'emulsion',rigidity:'medium',tailstockMode:'auto',routeCursor:0,resultCursor:0,results:[],projectId:null
};
const savedDraft=store.get(KEYS.draft,null);
if(savedDraft){ try{Object.assign(state,savedDraft); state.machine=normalizeMachineProfile(store.get(KEYS.machine,state.machine||deep(D.machineDefault))); state.results=[];state.resultCursor=0;state.selectedToolIds=Array.isArray(state.selectedToolIds)?state.selectedToolIds:[];state.requirements=Array.isArray(state.requirements)?state.requirements:[];state.tailstockMode=['auto','on','off'].includes(state.tailstockMode)?state.tailstockMode:'auto';state.route=Array.isArray(state.route)?state.route.map(normalizeRouteToolAssignments):[];state.routeCursor=Math.max(0,Number(state.routeCursor)||0);}catch{} }

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1900)}
function transition(fn){if(document.startViewTransition){document.startViewTransition(fn)}else fn()}
const STEP_META={1:'Станок',2:'Материал и заготовка',3:'Операции',4:'Инструмент',5:'Размеры операций',6:'Стратегия',7:'Расчёт',8:'Результат'};
function syncGuidedChrome(step=state.step,previous=step){
  const dir=step>=previous?'forward':'back';
  const bar=$('#stepProgressBar'),name=$('#stepStageName'),active=$(`#stepper [data-step="${step}"]`);
  if(bar)bar.style.width=`${((step-1)/7)*100}%`;if(name)name.textContent=STEP_META[step]||'';
  $$('#stepper [data-step]').forEach(b=>b.setAttribute('aria-current',+b.dataset.step===step?'step':'false'));
  active?.scrollIntoView?.({behavior:'smooth',block:'nearest',inline:'center'});
  const panel=$(`[data-step-panel="${step}"]`);if(!panel)return;
  panel.classList.remove('stage-enter-forward','stage-enter-back');void panel.offsetWidth;panel.classList.add(dir==='forward'?'stage-enter-forward':'stage-enter-back');
  clearTimeout(syncGuidedChrome.t);syncGuidedChrome.t=setTimeout(()=>panel.classList.remove('stage-enter-forward','stage-enter-back'),560);
}
function syncStockReveal(){
  const reveal=$('#stockReveal'),hint=$('#materialGateHint'),ready=!!state.materialId;if(!reveal)return;
  reveal.classList.toggle('ready',ready);hint?.classList.toggle('hidden',ready);
}
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
function normalizeTool(t){const iso=Array.isArray(t.iso)?t.iso:[t.iso||'P'],ops=Array.isArray(t.ops)?t.ops:['face','od'],source=t.source||'Мой шкаф',legacyLocalPassProfile=(source.startsWith('Добавлено вручную')||source.startsWith('ИИ-сканер'))&&t.passProfileRevision==null;return {...t,id:t.id||('local-'+uid()),iso,ops,passes:Array.isArray(t.passes)&&t.passes.length?t.passes:['rough','finish','single'],passProfileConfirmed:t.passProfileConfirmed??!legacyLocalPassProfile,passProfileRevision:t.passProfileRevision||0,quantity:Math.max(0,(t.quantity===null||t.quantity===undefined||t.quantity==='')?1:(Number.isFinite(+t.quantity)?+t.quantity:1)),location:t.location||'',libraryType:t.libraryType||'cupboard',photos:t.photos||{},canonicalKey:t.canonicalKey||canonicalToolKey(t),source,verified:t.verified??true,art:t.art||{shape:shapeFromInsert(t.insert),tone:'steel'}}}
function toolSupportsPass(t,pass){if(!t)return false;const passes=Array.isArray(t.passes)?t.passes:[];if(pass!=='single'&&t.passProfileConfirmed===false)return false;return pass==='single'?passes.includes('single')||(!passes.includes('rough')&&!passes.includes('finish')):passes.includes(pass)}
function normalizeRouteToolAssignments(route){const r={...route};if(r.toolId==null)r.toolId='auto';if(r.roughToolId==null)r.roughToolId='auto';if(r.finishToolId==null)r.finishToolId='auto';if(r.toolId!=='auto'&&operation(r.opId)?.supportsPass){const t=allTools().find(x=>x.id===r.toolId);if(r.pass==='both'){if(r.roughToolId==='auto'&&toolSupportsPass(t,'rough'))r.roughToolId=r.toolId;if(r.finishToolId==='auto'&&toolSupportsPass(t,'finish'))r.finishToolId=r.toolId;r.toolId='auto'}else if(r.pass==='rough'&&r.roughToolId==='auto'&&toolSupportsPass(t,'rough'))r.roughToolId=r.toolId;else if(r.pass==='finish'&&r.finishToolId==='auto'&&toolSupportsPass(t,'finish'))r.finishToolId=r.toolId}return r}
function routeToolChoice(route,pass){if(pass==='rough')return route.roughToolId??route.toolId??'auto';if(pass==='finish')return route.finishToolId??route.toolId??'auto';return route.toolId??'auto'}
function shapeFromInsert(insert){const c=String(insert||'').trim().toUpperCase()[0];return ({W:'wnmg',C:'ccmt',D:'dcmt',M:'mgmn',T:'thread'}[c]||'wnmg')}
function cupboardTools(){return store.get(KEYS.tools,[]).map(t=>normalizeTool(t))}
function saveCupboard(list){const normalized=list.map(normalizeTool);markExistingToolsActive(normalized);const ok=store.set(KEYS.tools,normalized);if(!ok){toast('Не хватило локальной памяти. Уменьши фото или удали старые карточки.');return false}renderTools();renderRoute();renderProcessToolTray();return true}
function materialAccentKey(m=material()){if(['pa6','pom'].includes(m.id))return m.id==='pa6'?'polymer':'polymer2';return m.iso}
function applyMaterialTheme(){const m=material(),root=document.documentElement;root.dataset.iso=m.iso;root.dataset.material=m.id;root.dataset.accent=materialAccentKey(m);}
function toolUseText(t){const ids=(t.ops||[]).filter((v,i,a)=>a.indexOf(v)===i);const labels=ids.map(opLabel).filter(Boolean);return labels.length?labels.join(' · '):'Назначение не задано'}
function toolPassText(t){if(t?.passProfileConfirmed===false)return 'черн./чист. не подтверждено';const p=Array.isArray(t?.passes)?t.passes:[];const labels=[];if(p.includes('rough'))labels.push('черновой');if(p.includes('finish'))labels.push('чистовой');if(p.includes('single')&&!labels.length)labels.push('рабочий');return labels.length?labels.join(' + '):'проход не задан'}
function toolNeedsPassProfile(t){return !!t&&t.libraryType==='cupboard'&&(t.ops||[]).some(x=>['face','od','bore'].includes(x))}
function setToolPassProfile(id,mode){const list=cupboardTools(),t=list.find(x=>x.id===id);if(!t)return;const single=(t.ops||[]).some(x=>!['face','od','bore'].includes(x))?['single']:[];t.passes=[...(mode==='rough'||mode==='both'?['rough']:[]),...(mode==='finish'||mode==='both'?['finish']:[]),...single];t.passProfileConfirmed=true;t.passProfileRevision=1;if(saveCupboard(list))toast(`${t.insert}: ${mode==='both'?'черновой + чистовой':mode==='rough'?'черновой':'чистовой'} режим подтверждён`)}
function noseLabel(t){return (t?.nose!==''&&t?.nose!=null&&Number.isFinite(+t.nose))?`R${Number(t.nose)}`:'R—'}
function isoDotsHtml(t){const pri=t.isoPriority||{},all=['P','M','K','N','S','H'];return `<div class="iso-dot-strip">${all.map(k=>{const st=pri[k]||((t.iso||[]).includes(k)?'secondary':'off');return `<span class="iso-dot iso-${k.toLowerCase()} ${st}" title="ISO ${k} · ${st}">${k}<i></i></span>`}).join('')}</div>`}
function requirementsForRoute(route){return (state.requirements||[]).filter(r=>r.operation==='all'||r.operation===route.opId)}
function isPrecisionRequirement(r){return r.type==='fit'||(r.type==='tolerance'&&+r.grade<=8)}
function requirementLabel(r){if(r.type==='tolerance')return `Ø${r.nominal} ${r.zone}${r.grade}`;if(r.type==='fit')return `Ø${r.nominal} ${r.fitName||r.fit}`;if(r.type==='thread')return `${r.thread} ${r.threadClass||''}`.trim();return r.text||'Требование'}
function stockMm(){const mul=state.stock.unit==='cm'?10:1,d=Number(state.stock.diameter),l=Number(state.stock.length);return{diameter:Number.isFinite(d)&&d>0?d*mul:0,length:Number.isFinite(l)&&l>0?l*mul:0}}
function rpmConstraints(){
  const m=state.machine,c=[];
  const add=(key,label,value)=>{const n=Number(value);if(Number.isFinite(n)&&n>0)c.push({key,label,value:n})};
  add('machine','лимит станка',m.maxRpm);add('hydraulic','гидроцилиндр '+(m.chuckCylinder?.model||''),m.chuckCylinder?.maxRpm);add('motor','двигатель '+(m.motor?.model||''),m.motor?.maxRpm);add('setup','текущий патрон/кулачки',m.setupMaxRpm);
  return c.sort((a,b)=>a.value-b.value);
}
function effectiveMaxRpm(){return rpmConstraints()[0]?.value||4000}
function effectiveRpmLimiter(){return rpmConstraints()[0]||{key:'machine',label:'лимит станка',value:effectiveMaxRpm()}}
function effectiveSpindlePowerKw(){const kw=Number(state.machine.spindleKw);return Number.isFinite(kw)&&kw>0?kw:17}
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
  const previous=clamp(+state.step||1,1,8);
  n=clamp(+n,1,8);
  if(n>=3&&!stockStepReady()){state.step=2;toast('Сначала выбери материал и введи фактические данные заготовки');n=2}
  if(n>=4&&!state.route.length){state.step=3;toast('Сначала выбери хотя бы одну операцию');n=3}
  if(n>=6&&!routeStepReady()){state.step=5;const bad=state.route.find(r=>!routeGeometry(r).ok);toast(bad?`${operation(bad.opId).name}: ${routeGeometry(bad).text}`:'Заполни размеры операций');n=5}
  if(n>=8&&!state.results.length){state.step=7;toast('Сначала рассчитай маршрут');n=7}
  state.step=n;
  document.documentElement.dataset.stepCurrent=String(n);
  document.body.classList.toggle('compact-work',n>1);
  transition(()=>{
    $$('[data-step-panel]').forEach(p=>p.classList.toggle('active',+p.dataset.stepPanel===n));
    $$('#stepper [data-step]').forEach(b=>{const st=+b.dataset.step;b.classList.toggle('active',st===n);b.classList.toggle('done',st<n)});
    $('#stepCaption').textContent=`Шаг ${n} из 8`;
  });
  syncGuidedChrome(n,previous);
  if(n===5){state.routeCursor=clamp(state.routeCursor||0,0,Math.max(0,state.route.length-1));renderRoute()}
  if(n===7)renderCalculateReady();
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
  const motor=m.motor||{},drive=m.drive||{},cyl=m.chuckCylinder||{};
  if($('#machineSpindleSpec'))$('#machineSpindleSpec').textContent=`${motor.family||'SIMOTICS M'} ${motor.model||''} · расчёт ${m.spindleKw} кВт`;
  if($('#machineDriveSpec'))$('#machineDriveSpec').textContent=`${drive.system||'SINAMICS S120 Combi'} · реактор ${drive.lineReactorClassKw||'—'} кВт`;
  if($('#machineSafetySpec'))$('#machineSafetySpec').textContent=`станок ${m.maxRpm} · ${cyl.model||'гидроцилиндр'} ${cyl.maxRpm||'—'} · мотор ${motor.maxRpm||'—'} об/мин`;
  $('#topMachine').textContent=`${m.name.replace('Tengyue ','')} · 828D`;
}
$('#saveMachineProfile').addEventListener('click',()=>{
  state.machine.maxRpm=Math.max(100,+$('#machineMaxRpm').value||4000);state.machine.spindleKw=Math.max(1,+$('#machineKw').value||17);state.machine.efficiency=clamp(+$('#machineEff').value||.85,.5,1);
  state.machine.setupMaxRpm=$('#setupMaxRpm').value?Math.max(100,+$('#setupMaxRpm').value):null;state.machine.tailstockMExtend=$('#tailstockMExtend').value.trim();state.machine.tailstockMRetract=$('#tailstockMRetract').value.trim();
  store.set(KEYS.machine,state.machine);syncMachineUI();saveDraft();toast('Профиль станка сохранён локально');
});
$('#projectName').addEventListener('input',saveDraft);

function renderMaterials(){
  const box=$('#materialGrid');
  box.innerHTML=D.materials.map(m=>`<button class="material-card iso-tint ${m.id===state.materialId?'selected':''}" data-iso="${m.iso}" data-accent="${['pa6','pom'].includes(m.id)?(m.id==='pa6'?'polymer':'polymer2'):m.iso}" data-material="${m.id}"><i>ISO ${m.iso}</i><b>${m.short}</b><span>${m.name}</span></button>`).join('');
  box.querySelectorAll('[data-material]').forEach(b=>b.addEventListener('click',()=>{
    state.materialId=b.dataset.material;applyMaterialTheme();renderMaterials();syncStockReveal();updateMaterialInfo();renderOperationCatalog();renderProcessToolTray();validateStockStep();saveDraft();
  }));
  if(state.materialId){$('#selectedIso').textContent=`ISO ${material().iso}`;applyMaterialTheme()}else{$('#selectedIso').textContent='МАТЕРИАЛ НЕ ВЫБРАН';document.documentElement.removeAttribute('data-iso');document.documentElement.removeAttribute('data-material');}
  syncStockReveal();
}
function updateMaterialInfo(){
  if(!state.materialId){$('#materialNote').innerHTML='<b>Сначала выбери материал</b> · размеры заготовки вводятся вручную.';$('#selectedIso').textContent='МАТЕРИАЛ НЕ ВЫБРАН';updateSlenderness();validateStockStep();return}
  const m=material();applyMaterialTheme();$('#materialNote').innerHTML=`<b>${m.name}</b> · ${m.note}`;$('#selectedIso').textContent=`ISO ${m.iso}`;
  updateSlenderness();validateStockStep();
}
function readStock(){
  const d=$('#stockDiameter').value.trim(),l=$('#stockLength').value.trim(),h=$('#stockHardness').value.trim();
  state.stock.diameter=d===''?null:+d;state.stock.length=l===''?null:+l;state.stock.unit=$('#stockUnit').value;state.stock.hardness=h===''?null:+h;
  updateSlenderness();validateStockStep();saveDraft();
}
['stockDiameter','stockLength','stockUnit','stockHardness'].forEach(id=>$('#'+id).addEventListener('input',readStock));
function syncStockUI(){ $('#stockDiameter').value=state.stock.diameter??'';$('#stockLength').value=state.stock.length??'';$('#stockUnit').value=state.stock.unit||'mm';$('#stockHardness').value=state.stock.hardness??'';updateMaterialInfo(); }
function stockStepReady(){const s=stockMm();return !!state.materialId&&s.diameter>0&&s.length>0}
function validateStockStep(){const btn=$('#toProcessBtn');if(!btn)return;const ready=stockStepReady();btn.disabled=!ready;btn.title=ready?'':'Выбери материал и введи фактические Ø и длину; твёрдость можно оставить пустой, если она неизвестна'}
function updateSlenderness(){
  const s=stockMm(),card=$('#slendernessCard');
  if(!(s.diameter>0&&s.length>0)){card.innerHTML='<div class="ratio">L/D —</div><div><b>Жду размеры заготовки</b><span>После ввода Ø и длины Copilot автоматически оценит жёсткость и необходимость задней бабки.</span></div>';card.classList.remove('warn');card.classList.add('is-empty');return}
  card.classList.remove('is-empty');const ratio=s.length/s.diameter;let title='Жёсткая заготовка',desc='По отношению L/D дополнительная опора обычно не требуется.',cls='';
  if(ratio>=4){title='Задняя бабка настоятельно рекомендуется';desc='L/D высокий. Для наружного точения добавь центровку и опору, если геометрия детали позволяет.';cls='warn'}
  else if(ratio>=3){title='Проверь необходимость задней бабки';desc='L/D уже чувствителен к вылету. Copilot отметит операции, где опора полезна.';cls='warn'}
  card.innerHTML=`<div class="ratio">L/D ${ratio.toFixed(2)}</div><div><b>${title}</b><span>${desc}</span></div>`;card.classList.toggle('warn',!!cls);
}

function currentOuterDiameter(){
  let d=stockMm().diameter;
  for(const r of state.route){if(r.opId==='od'&&Number(r.targetDiameter)>0&&Number(r.targetDiameter)<d)d=Number(r.targetDiameter)}
  return d;
}
function makeRoute(opId){
  if(!stockStepReady())throw new Error('Заготовка не заполнена');
  const op=operation(opId),outer=currentOuterDiameter();
  const base={uid:uid(),opId,pass:op.defaultPass,toolId:'auto',roughToolId:'auto',finishToolId:'auto',diameter:null,targetDiameter:null,depth:null,pitch:null,width:null,threadSize:'',diameterSource:'manual'};
  if(['face','od','groove','part'].includes(opId)){base.diameter=outer;base.diameterSource='auto'}
  return base;
}
function syncInheritedDiameters(){
  let outer=stockMm().diameter;
  for(const r of state.route){
    if(['face','od','groove','part'].includes(r.opId)&&r.diameterSource!=='manual')r.diameter=outer;
    if(r.opId==='od'&&Number(r.targetDiameter)>0&&Number(r.targetDiameter)<Number(r.diameter||outer))outer=Number(r.targetDiameter);
  }
}
function numInputValue(v){return v===null||v===undefined||v===''?'':esc(v)}
function routeGeometry(r){
  const d=Number(r.diameter),t=Number(r.targetDiameter),dep=Number(r.depth),w=Number(r.width),p=Number(r.pitch);
  if(!(d>0))return {ok:false,text:'Укажи исходный размер операции'};
  if(r.opId==='od'){
    if(!(t>0))return {ok:false,text:'Укажи целевой Ø по чертежу'};
    if(t>=d)return {ok:false,text:'Для наружного точения целевой Ø должен быть меньше исходного'};
    return {ok:true,text:`Снять ${(d-t).toFixed(2)} мм по Ø · ${(Math.abs(d-t)/2).toFixed(2)} мм на сторону`};
  }
  if(r.opId==='bore'){
    if(!(t>0))return {ok:false,text:'Укажи целевой внутренний Ø по чертежу'};
    if(t<=d)return {ok:false,text:'Для расточки целевой Ø должен быть больше исходного'};
    return {ok:true,text:`Расточить +${(t-d).toFixed(2)} мм по Ø · ${(Math.abs(t-d)/2).toFixed(2)} мм на сторону`};
  }
  if(r.opId==='face')return dep>0?{ok:true,text:`Снять по торцу ${dep.toFixed(2)} мм по Z`}:{ok:false,text:'Укажи припуск, который нужно снять по Z'};
  if(['drill','center'].includes(r.opId))return dep>0?{ok:true,text:`Глубина ${dep.toFixed(2)} мм`}:{ok:false,text:'Укажи глубину обработки'};
  if(['groove','part'].includes(r.opId))return w>0?{ok:true,text:`Ширина ${w.toFixed(2)} мм`}:{ok:false,text:'Укажи ширину пластины / канавки'};
  if(r.opId.startsWith('thread'))return p>0?{ok:true,text:`Шаг резьбы P ${p.toFixed(2)} мм`}:{ok:false,text:'Укажи шаг резьбы по чертежу'};
  return dep>0?{ok:true,text:'Размер операции задан'}:{ok:false,text:'Заполни размер операции'};
}
function routeStepReady(){return state.route.length>0&&state.route.every(r=>routeGeometry(r).ok&&routeToolPlanReady(r))}
function routeSetupIndexUnlocked(index){
  if(index<=0)return true;
  return state.route.slice(0,index).every(r=>routeGeometry(r).ok&&routeToolPlanReady(r));
}
function firstIncompleteRouteIndex(){
  const i=state.route.findIndex(r=>!routeGeometry(r).ok||!routeToolPlanReady(r));
  return i<0?Math.max(0,state.route.length-1):i;
}
function renderOperationCatalog(){
  const m=material();
  $('#operationCatalog').innerHTML=D.operations.map((o,idx)=>{const count=operationCount(o.id);const candidates=recommendCandidateTools(o.id);const assigned=candidates[0];return `<div class="op-add-wrap iso-tint" style="--item-i:${idx}" data-iso="${m.iso}"><button class="op-add ${count?'selected':''}" data-add-op="${o.id}" aria-pressed="${count?'true':'false'}"><strong>${o.icon}</strong><i class="op-plus">+</i>${count?`<em class="op-count">×${count}</em>`:''}<b>${o.name}</b><span>${o.description}</span><small>${assigned?`${esc(assigned.insert)} · ${assigned.libraryType==='cupboard'?'мой шкаф':'каталог'}`:'Нет подходящего инструмента'}</small></button>${count?`<button class="op-minus" data-minus-op="${o.id}" title="Убрать одну операцию">−</button>`:''}</div>`}).join('');
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
  box.innerHTML=all.map(t=>{const on=state.selectedToolIds?.includes(t.id);const compatible=t.iso?.includes(material().iso);return `<button class="process-tool-chip ${on?'selected':''} ${compatible?'':'muted-tool'}" data-tray-tool="${t.id}">${toolThumbHtml(t,'tray-'+t.id)}<span><b>${esc(t.insert)}</b><small>${esc(t.location||t.holder||'без ячейки')} · ${t.quantity??'—'} шт. · ${esc(toolPassText(t))}</small></span><i>${on?'✓':'+'}</i></button>`}).join('');
  box.querySelectorAll('[data-tray-tool]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.trayTool;state.selectedToolIds=state.selectedToolIds||[];state.selectedToolIds=state.selectedToolIds.includes(id)?state.selectedToolIds.filter(x=>x!==id):[...state.selectedToolIds,id];renderProcessToolTray();renderOperationCatalog();renderRoute();saveDraft()}));
  const cnt=state.selectedToolIds?.length||0;$('#toolTrayCount').textContent=cnt?`${cnt} выбрано`:'автоподбор';
}
function toolOptions(route,pass='single'){
  const op=operation(route.opId),m=material(),tools=allTools(),choice=routeToolChoice(route,pass);
  let filtered=tools.filter(t=>t.iso.includes(m.iso)&&t.ops.some(x=>op.toolOps.includes(x))&&toolSupportsPass(t,pass));
  if(state.selectedToolIds?.length)filtered=filtered.filter(t=>state.selectedToolIds.includes(t.id));
  filtered.sort((a,b)=>((b.libraryType==='cupboard')-(a.libraryType==='cupboard'))+((b.verified?1:0)-(a.verified?1:0)));
  const auto=recommendTool(route,pass),autoLabel=auto?`Автоподбор · ${auto.libraryType==='cupboard'?'мой шкаф':'каталог'} · ${auto.insert}`:`Автоподбор · нет совместимого инструмента`;
  return `<option value="auto" ${choice==='auto'?'selected':''}>${esc(autoLabel)}</option>`+filtered.map(t=>`<option value="${t.id}" ${choice===t.id?'selected':''}>${t.libraryType==='cupboard'?'● ':''}${t.holder} · ${t.insert}</option>`).join('');
}
function routeToolPasses(route){const op=operation(route.opId);if(!op?.supportsPass)return['single'];return route.pass==='both'?['rough','finish']:[route.pass]}
function routeToolPlan(route){return routeToolPasses(route).map(pass=>({pass,tool:recommendTool(route,pass)}))}
function routeToolPlanReady(route){return routeToolPlan(route).every(x=>!!x.tool)}
function routeToolPlanText(route){const plan=routeToolPlan(route);if(plan.some(x=>!x.tool))return 'Не назначен совместимый инструмент';if(plan.length===2){const [a,b]=plan;if(a.tool.id===b.tool.id)return `Одна сборка для двух проходов · ${a.tool.insert}`;return `Черновой ${a.tool.insert} → чистовой ${b.tool.insert}`}return plan[0]?.tool?.insert||'Инструмент не назначен'}
function routeToolFields(route){const op=operation(route.opId);if(!op?.supportsPass)return `<label class="field tool-field">Инструмент<select data-rid="${route.uid}" data-rfield="toolId">${toolOptions(route,'single')}</select></label>`;if(route.pass==='both')return `<label class="field tool-field rough-tool-field">Черновой инструмент<select data-rid="${route.uid}" data-rfield="roughToolId">${toolOptions(route,'rough')}</select><small class="field-hint">только сборки, разрешённые для чернового прохода</small></label><label class="field tool-field finish-tool-field">Чистовой инструмент<select data-rid="${route.uid}" data-rfield="finishToolId">${toolOptions(route,'finish')}</select><small class="field-hint">только сборки, разрешённые для чистового прохода</small></label>`;const pass=route.pass==='finish'?'finish':'rough',field=pass==='finish'?'finishToolId':'roughToolId',label=pass==='finish'?'Чистовой инструмент':'Черновой инструмент';return `<label class="field tool-field">${label}<select data-rid="${route.uid}" data-rfield="${field}">${toolOptions(route,pass)}</select></label>`}
function opFields(r){
  const outerAuto=r.diameterSource==='auto'?' <small class="field-hint">из предыдущей операции</small>':'';
  const dia=`<label class="field">Сырьё / было Ø, мм${outerAuto}<input data-rid="${r.uid}" data-rfield="diameter" type="number" step="0.1" min="0.1" value="${numInputValue(r.diameter)}" placeholder="фактический размер"></label>`;
  if(r.opId==='od')return dia+`<label class="field target-field">По чертежу / должно стать Ø, мм<input data-rid="${r.uid}" data-rfield="targetDiameter" type="number" step="0.1" min="0.1" value="${numInputValue(r.targetDiameter)}" placeholder="введи целевой Ø"></label>`;
  if(r.opId==='bore')return dia+`<label class="field target-field">По чертежу / внутренний Ø, мм<input data-rid="${r.uid}" data-rfield="targetDiameter" type="number" step="0.1" min="0.1" value="${numInputValue(r.targetDiameter)}" placeholder="введи целевой Ø"></label>`;
  if(r.opId==='face')return dia+`<label class="field target-field">Снять по торцу Z, мм<input data-rid="${r.uid}" data-rfield="depth" type="number" step="0.1" min="0.01" value="${numInputValue(r.depth)}" placeholder="припуск по Z"></label>`;
  if(r.opId==='groove')return dia+`<label class="field target-field">Ширина канавки, мм<input data-rid="${r.uid}" data-rfield="width" type="number" step="0.1" min="0.1" value="${numInputValue(r.width)}" placeholder="по чертежу"></label>`;
  if(r.opId==='part')return dia+`<label class="field target-field">Ширина пластины, мм<input data-rid="${r.uid}" data-rfield="width" type="number" step="0.1" min="0.1" value="${numInputValue(r.width)}" placeholder="фактическая пластина"></label>`;
  if(r.opId==='drill'||r.opId==='center')return dia+`<label class="field target-field">Глубина по чертежу, мм<input data-rid="${r.uid}" data-rfield="depth" type="number" step="0.1" min="0.1" value="${numInputValue(r.depth)}" placeholder="введи глубину"></label>`;
  if(r.opId.startsWith('thread'))return dia+`<label class="field target-field">Шаг резьбы P, мм<input data-rid="${r.uid}" data-rfield="pitch" type="number" step="0.05" min="0.05" value="${numInputValue(r.pitch)}" placeholder="по чертежу"></label>`;
  return dia+`<label class="field target-field">Размер по чертежу, мм<input data-rid="${r.uid}" data-rfield="depth" type="number" step="0.1" min="0.1" value="${numInputValue(r.depth)}" placeholder="введи размер"></label>`;
}
function renderRoute(){
  syncInheritedDiameters();
  const n=state.route.length,word=(n%10===1&&n%100!==11)?'операция':([2,3,4].includes(n%10)&&![12,13,14].includes(n%100)?'операции':'операций');
  const count=$('#routeCount');if(count)count.textContent=`${n} ${word}`;
  const empty=$('#routeEmpty');if(empty)empty.classList.toggle('hidden',n>0);
  const toolsCard=$('#processToolsCard');if(toolsCard)toolsCard.classList.toggle('hidden',n===0);
  renderOperationCatalog();renderProcessToolTray();syncTailstockUI();
  const box=$('#routeList');if(!box)return;
  if(!n){box.innerHTML='';renderRouteQueue();return}
  state.routeCursor=clamp(Number(state.routeCursor)||0,0,n-1);
  if(!routeSetupIndexUnlocked(state.routeCursor))state.routeCursor=firstIncompleteRouteIndex();
  const r=state.route[state.routeCursor],i=state.routeCursor,op=operation(r.opId),toolPlan=routeToolPlan(r),toolReady=routeToolPlanReady(r),reqs=requirementsForRoute(r),g=routeGeometry(r);
  const progress=$('#routeProgress');if(progress)progress.textContent=`${i+1} / ${n}`;
  const title=$('#routeSetupTitle');if(title)title.textContent=`${op.icon} ${op.name}`;
  const subtitle=$('#routeSetupSubtitle');if(subtitle)subtitle.textContent=`Операция ${i+1} из ${n}. Заполни только её — затем Copilot откроет следующую.`;
  box.innerHTML=`<article class="route-item guided-route-card glass iso-tint" data-iso="${material().iso}" data-route="${r.uid}"><div class="route-order">${i+1}</div><div class="route-main"><div class="route-title-line"><div><h4>${op.icon} ${op.name}</h4><p>${op.description}</p></div><span class="assigned-mini ${toolReady?'':'need'}"><small>${toolPlan.length>1?'ИНСТРУМЕНТЫ ПРОХОДОВ':'ИНСТРУМЕНТ'}</small><b>${esc(routeToolPlanText(r))}</b></span></div>${reqs.length?`<div class="route-requirements">${reqs.map(x=>`<span>${esc(requirementLabel(x))}</span>`).join('')}</div>`:''}${op.supportsPass?`<div class="pass-switch"><button data-pass="rough" data-rid="${r.uid}" class="${r.pass==='rough'?'active':''}">Черновая</button><button data-pass="finish" data-rid="${r.uid}" class="${r.pass==='finish'?'active':''}">Чистовая</button><button data-pass="both" data-rid="${r.uid}" class="${r.pass==='both'?'active':''}">Черновая + чистовая</button></div>`:''}<div class="route-controls">${opFields(r)}${routeToolFields(r)}</div><div class="geometry-status ${g.ok&&toolReady?'ok':'need'}"><span>${g.ok&&toolReady?'✓':'!'}</span><b>${esc(!g.ok?g.text:toolReady?g.text:'Назначь совместимый инструмент для каждого прохода')}</b></div></div><div class="route-actions"><button data-up="${r.uid}" title="Выше">↑</button><button data-down="${r.uid}" title="Ниже">↓</button><button data-remove="${r.uid}" title="Удалить">×</button></div></article>`;
  box.querySelectorAll('[data-pass]').forEach(b=>b.addEventListener('click',()=>{const x=state.route.find(v=>v.uid===b.dataset.rid);x.pass=b.dataset.pass;Object.assign(x,normalizeRouteToolAssignments(x));renderRoute();saveDraft()}));
  box.querySelectorAll('[data-rfield]').forEach(el=>el.addEventListener('change',()=>{const x=state.route.find(v=>v.uid===el.dataset.rid),f=el.dataset.rfield;if(['toolId','roughToolId','finishToolId'].includes(f))x[f]=el.value;else{x[f]=el.value.trim()===''?null:+el.value;if(f==='diameter')x.diameterSource='manual'}syncInheritedDiameters();renderRoute();renderCalculateReady();saveDraft()}));
  box.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{state.route=state.route.filter(x=>x.uid!==b.dataset.remove);state.routeCursor=clamp(state.routeCursor,0,Math.max(0,state.route.length-1));renderRoute();saveDraft()}));
  box.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>moveRoute(b.dataset.up,-1)));box.querySelectorAll('[data-down]').forEach(b=>b.addEventListener('click',()=>moveRoute(b.dataset.down,1)));
  renderRouteQueue();syncRouteAdvanceButtons();
}
function renderRouteQueue(){
  const q=$('#routeQueue');if(!q)return;if(!state.route.length){q.innerHTML='';return}
  q.innerHTML=state.route.map((r,i)=>{const g=routeGeometry(r),ready=g.ok&&routeToolPlanReady(r),unlocked=routeSetupIndexUnlocked(i);return `<button class="route-queue-chip ${i===state.routeCursor?'active':''} ${ready?'done':'need'} ${unlocked?'':'locked'}" data-route-index="${i}" ${unlocked?'':'disabled'}><i>${ready?'✓':unlocked?i+1:'⌕'}</i><span>${operation(r.opId).name}</span></button>`}).join('');
  q.querySelectorAll('[data-route-index]').forEach(b=>b.addEventListener('click',()=>{const i=+b.dataset.routeIndex;if(!routeSetupIndexUnlocked(i)){toast('Сначала закончи предыдущую операцию');return}state.routeCursor=i;renderRoute();saveDraft()}));
}
function syncRouteAdvanceButtons(){const prev=$('#prevRouteSetupBtn'),next=$('#toStrategyBtn');if(!prev||!next)return;const n=state.route.length,i=clamp(state.routeCursor||0,0,Math.max(0,n-1)),r=n?state.route[i]:null,g=r?routeGeometry(r):{ok:false,text:'Операция не выбрана'},ready=!!r&&g.ok&&routeToolPlanReady(r);prev.disabled=i===0;next.disabled=!ready;next.classList.toggle('is-disabled',!ready);next.setAttribute('aria-disabled',String(!ready));next.innerHTML=i<n-1?'Следующая операция <span>→</span>':'Стратегия и проверка <span>→</span>';next.title=ready?'':!g.ok?`Заполни геометрию операции · ${g.text}`:'Назначь совместимый инструмент для каждого прохода'}
function moveRoute(id,dir){const i=state.route.findIndex(x=>x.uid===id),j=i+dir;if(i<0||j<0||j>=state.route.length)return;[state.route[i],state.route[j]]=[state.route[j],state.route[i]];state.routeCursor=j;syncInheritedDiameters();renderRoute();saveDraft()}
$('#toToolsBtn')?.addEventListener('click',()=>{if(!state.route.length){toast('Сначала выбери хотя бы одну операцию');return}goStep(4)});
$('#toRouteSetupBtn')?.addEventListener('click',()=>{if(!state.route.length){goStep(3);return}state.routeCursor=0;goStep(5)});
$('#prevRouteSetupBtn')?.addEventListener('click',()=>{if(state.routeCursor>0){state.routeCursor--;renderRoute();saveDraft()}else goStep(4)});
$('#toStrategyBtn')?.addEventListener('click',()=>{if(!state.route.length){toast('Сначала добавь хотя бы одну операцию');goStep(3);return}const r=state.route[state.routeCursor],g=routeGeometry(r);if(!g.ok){toast(`${operation(r.opId).name}: ${g.text}`);return}if(!routeToolPlanReady(r)){toast(`${operation(r.opId).name}: назначь инструмент для каждого прохода`);return}if(state.routeCursor<state.route.length-1){state.routeCursor++;renderRoute();saveDraft();return}const bad=state.route.find(x=>!routeGeometry(x).ok||!routeToolPlanReady(x));if(bad){state.routeCursor=state.route.indexOf(bad);renderRoute();toast(`${operation(bad.opId).name}: ${!routeGeometry(bad).ok?routeGeometry(bad).text:'назначь совместимый инструмент для каждого прохода'}`);return}goStep(6);renderPreflight()});

function syncTailstockUI(){const mode=state.tailstockMode||'auto';$$('#tailstockSwitch [data-tailstock-mode]').forEach(b=>b.classList.toggle('active',b.dataset.tailstockMode===mode));const hint=$('#tailstockHint');if(hint)hint.textContent=mode==='on'?'подпереть':mode==='off'?'без бабки':'авто по L/D'}
$$('#tailstockSwitch [data-tailstock-mode]').forEach(b=>b.addEventListener('click',()=>{state.tailstockMode=b.dataset.tailstockMode;syncTailstockUI();renderPreflight();saveDraft()}));
$$('#strategySwitch [data-strategy]').forEach(b=>b.addEventListener('click',()=>{state.strategy=b.dataset.strategy;$$('#strategySwitch [data-strategy]').forEach(x=>x.classList.toggle('active',x===b));renderPreflight();saveDraft()}));
$('#coolant').addEventListener('change',()=>{state.coolant=$('#coolant').value;saveDraft()});$('#rigidity').addEventListener('change',()=>{state.rigidity=$('#rigidity').value;renderPreflight();saveDraft()});
function renderPreflight(){
  const s=stockMm(),ratio=s.length/s.diameter,m=state.machine,max=effectiveMaxRpm(),limiter=effectiveRpmLimiter();const rows=[];
  rows.push({ok:!!m.verifiedProfile,t:`Профиль станка: ${m.name} · ${m.verifiedProfile?'подтверждён по шильдикам':'пользовательский / не подтверждён'}`});
  rows.push({ok:true,t:`Обороты: расчётный LIMS ${max} об/мин · ограничивает ${limiter.label}`});
  rows.push({ok:true,t:`Механические пределы: станок ${m.maxRpm} · ${m.chuckCylinder?.model||'гидроцилиндр'} ${m.chuckCylinder?.maxRpm||'—'} · двигатель ${m.motor?.maxRpm||'—'} об/мин`});
  rows.push({ok:true,t:`Мощность для расчёта: ${effectiveSpindlePowerKw()} кВт · мотор ${m.motor?.s1?.[0]?.kw||17}–${m.motor?.s1?.at?.(-1)?.kw||24} кВт S1 · ${m.drive?.system||'SINAMICS S120 Combi'}`});
  rows.push({ok:true,t:`Материал: ${material().name} · ISO ${material().iso} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм`});
  rows.push({ok:state.route.length>0,t:`Маршрут: ${state.route.length} операций · требований чертежа: ${(state.requirements||[]).length}`});
  const critical=(state.requirements||[]).filter(isPrecisionRequirement);if(critical.length)rows.push({ok:true,t:`Точность: ${critical.map(requirementLabel).slice(0,3).join(', ')}${critical.length>3?'…':''} — чистовые проходы будут разгружены и отмечены для контроля.`});
  state.route.forEach(r=>{if(requirementsForRoute(r).some(isPrecisionRequirement)&&operation(r.opId)?.supportsPass&&r.pass==='rough')rows.push({ok:false,t:`${operation(r.opId).name}: есть точный размер, но выбран только черновой проход. Проверь необходимость чистового.`})});
  state.route.forEach(r=>{const plan=routeToolPlan(r);if(plan.some(x=>!x.tool))rows.push({ok:false,t:`${operation(r.opId).name}: нет совместимого инструмента для ${plan.find(x=>!x.tool)?.pass==='finish'?'чистового':'чернового/рабочего'} прохода.`});else if(plan.length===2&&plan[0].tool.id===plan[1].tool.id)rows.push({ok:true,t:`${operation(r.opId).name}: одна сборка ${plan[0].tool.insert} явно разрешена и для чернового, и для чистового прохода.`})});
  if(ratio>=3)rows.push({ok:false,t:`L/D ${ratio.toFixed(2)} — проверь заднюю бабку и центровку для длинных наружных проходов.`});
  const tailstockPlanned=state.tailstockMode==='on'||(state.tailstockMode==='auto'&&ratio>=3&&state.route.some(r=>r.opId==='od'));
  if(tailstockPlanned&&!state.route.some(r=>r.opId==='center'))rows.push({ok:false,t:'Задняя бабка планируется, но в маршруте нет центровки. Если центровочное отверстие уже готово — это нормально; иначе добавь «Центровка» перед наружной обработкой.'});
  if(!m.setupMaxRpm)rows.push({ok:false,t:`Лимит конкретного патрона/кулачков не задан — расчёт всё равно ограничен ${max} об/мин по профилю станка. Перед высокими оборотами проверь паспорт зажима.`});
  $('#preflight').innerHTML=rows.map(r=>`<div class="preflight-row ${r.ok?'':'warn'}"><i>${r.ok?'✓':'!'}</i><span>${r.t}</span></div>`).join('');
}

function recommendTool(route,pass){
  const op=operation(route.opId),iso=material().iso,tools=allTools(),choice=routeToolChoice(route,pass);
  const compatible=t=>t&&t.iso.includes(iso)&&t.ops.some(x=>op.toolOps.includes(x))&&toolSupportsPass(t,pass);
  if(choice!=='auto'){const manual=tools.find(t=>t.id===choice);return compatible(manual)?manual:null}
  let pool=state.selectedToolIds?.length?tools.filter(t=>state.selectedToolIds.includes(t.id)):tools;
  let c=pool.filter(compatible);
  c.sort((a,b)=>((b.libraryType==='cupboard')-(a.libraryType==='cupboard'))+((b.verified?1:0)-(a.verified?1:0))+((b.quantity||0)-(a.quantity||0)));
  if(c[0])return c[0];
  // Если в выбранном наборе нет нужного прохода, разрешён fallback только к совместимому каталожному/шкафному инструменту. Черновой инструмент никогда не подменяет чистовой.
  const fallback=tools.filter(compatible).sort((a,b)=>((b.libraryType==='cupboard')-(a.libraryType==='cupboard'))+((b.verified?1:0)-(a.verified?1:0)));
  return fallback[0]||null;
}
function routeToolSummary(route){return routeToolPlanText(route)}
function routeStockRemoval(route){
  const d=Number(route.diameter),t=Number(route.targetDiameter),dep=Number(route.depth);
  if(route.opId==='od'&&d>0&&t>0&&t<d)return {kind:'radial',total:Math.abs(d-t)/2,label:`${(d-t).toFixed(2)} мм по Ø`};
  if(route.opId==='bore'&&d>0&&t>0&&t>d)return {kind:'radial',total:Math.abs(t-d)/2,label:`${(t-d).toFixed(2)} мм по Ø`};
  if(route.opId==='face'&&dep>0)return {kind:'axial',total:dep,label:`${dep.toFixed(2)} мм по Z`};
  return null;
}
function applyPlannedAp(pass,plannedAp){
  if(!(plannedAp>0))return;
  pass.ap=round(plannedAp,3);
  const m=material(),machine=state.machine;let q=pass.ap*pass.f*pass.vc,pc=m.kc*q/60000;
  if(['groove','part'].includes(pass.opId))pc*=Math.max(1,(+state.route.find(r=>r.uid===pass.routeUid)?.width||3)/2);
  if(['drill','center'].includes(pass.opId))pc*=.65;
  pass.power=round(pc/Math.max(.5,machine.efficiency||.85),2);pass.powerPct=round(pass.power/effectiveSpindlePowerKw()*100);
  if(pass.trial)pass.trial.ap=round(pass.ap*(pass.opId.startsWith('thread')?.75:.55),3);
}
function annotatePassPlan(route,passes){
  const removal=routeStockRemoval(route);
  if(!removal||!passes.length)return passes.map(p=>({...p,cutCount:1,removalPerPass:null,removalTotal:null}));
  const rough=passes.find(p=>p.pass==='rough'),finish=passes.find(p=>p.pass==='finish');
  let finishStock=0;
  if(finish)finishStock=Math.min(removal.total,Math.max(.02,Number(finish.ap)||0));
  const roughStock=Math.max(0,removal.total-finishStock);
  if(rough){
    const maxAp=Math.max(.02,Number(rough.ap)||.02),count=Math.max(roughStock>0?1:0,Math.ceil(roughStock/maxAp)),planned=count?roughStock/count:0;
    rough.cutCount=count;rough.removalTotal=round(roughStock,3);rough.removalPerPass=count?round(planned,3):0;rough.stockRemovalLabel=removal.label;if(count)applyPlannedAp(rough,planned);
  }
  if(finish){finish.cutCount=finishStock>0?1:0;finish.removalTotal=round(finishStock,3);finish.removalPerPass=round(finishStock,3);finish.stockRemovalLabel=removal.label;if(finishStock>0)applyPlannedAp(finish,finishStock)}
  if(!rough&&!finish){
    passes.forEach(p=>{const maxAp=Math.max(.02,Number(p.ap)||.02),count=Math.max(1,Math.ceil(removal.total/maxAp)),planned=removal.total/count;p.cutCount=count;p.removalTotal=round(removal.total,3);p.removalPerPass=round(planned,3);p.stockRemovalLabel=removal.label;applyPlannedAp(p,planned)});
  }
  if(rough&&!finish){
    const count=Math.max(1,Math.ceil(removal.total/Math.max(.02,Number(rough.ap)||.02))),planned=removal.total/count;rough.cutCount=count;rough.removalTotal=round(removal.total,3);rough.removalPerPass=round(planned,3);rough.stockRemovalLabel=removal.label;applyPlannedAp(rough,planned);
  }
  if(finish&&!rough){finish.cutCount=1;finish.removalTotal=round(removal.total,3);finish.removalPerPass=round(removal.total,3);finish.stockRemovalLabel=removal.label;finish.finishOnlyHeavy=removal.total>Math.max(.15,(Number(finish.ap)||.15)*1.35);applyPlannedAp(finish,removal.total)}
  return passes.filter(p=>p.cutCount!==0);
}
function calcPass(route,pass){
  const op=operation(route.opId),m=material(),machine=state.machine,key=passKey(route.opId,pass),r=m.ranges[key]||m.ranges.rough,t=modeT();
  let vc=rangeValue(r.vc,t),f=rangeValue(r.f,t),ap=rangeValue(r.ap,t);const dia=Math.max(.1,+route.diameter||stockMm().diameter);const tool=recommendTool(route,pass);
  if(!tool)throw new Error(`${op.name}: не назначен совместимый инструмент для ${pass==='finish'?'чистового':pass==='rough'?'чернового':'рабочего'} прохода`);
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
  const availableKw=effectiveSpindlePowerKw();
  if(motor>availableKw*.88 && ['od','face','bore'].includes(route.opId) && pass!=='finish'){
    const scale=clamp((availableKw*.78)/motor,.35,1);ap*=scale;q=ap*f*actualVc;pc=m.kc*q/60000;motor=pc/(machine.efficiency||.85);powerLimited=true;
  }
  let ra=null;if(tool.nose>0&&['od','face','bore'].includes(route.opId)){ra=(f*f/(32*tool.nose))*1000}
  const tailstock=shouldUseTailstock(route);
  const trial={rpm:round(rpm*(route.opId.startsWith('thread')?.86:.90)),f:round(route.opId.startsWith('thread')?f:f*.84,3),ap:round(ap*(route.opId.startsWith('thread')?.75:.55),3)};trial.vc=round(Math.PI*dia*trial.rpm/1000,1);
  return {id:`${route.uid}:${pass}`,routeUid:route.uid,opId:route.opId,pass,diameter:dia,toolId:tool.id,tool:deep(tool),vc:round(actualVc,1),targetVc:round(vc,1),rpm:round(rpm),rawRpm:round(rawRpm),f:round(f,3),ap:round(ap,3),power:round(motor,2),powerPct:round(motor/availableKw*100),ra:ra==null?null:round(ra,2),rpmLimited:rawRpm>limit,powerLimited,threadDepth:threadDepth==null?null:round(threadDepth,3),threadPasses,trial,verified:false,revision:0,lastFeedback:null,tailstock,range:deep(r),requirements:deep(reqs),precision};
}
function shouldUseTailstock(route){if(!['od'].includes(route.opId))return false;if(state.tailstockMode==='on')return true;if(state.tailstockMode==='off')return false;const s=stockMm(),ratio=s.length/s.diameter;return state.machine.tailstock&&ratio>=3}
function calculateRoute(){
  state.results=state.route.map(route=>{const op=operation(route.opId),passKinds=op.supportsPass?(route.pass==='both'?['rough','finish']:[route.pass]):['single'],passes=annotatePassPlan(route,passKinds.map(p=>calcPass(route,p)));return{routeUid:route.uid,opId:route.opId,name:op.name,passes}});
  state.resultCursor=0;
}
function resultGroupVerified(group){return !!group?.passes?.length&&group.passes.every(p=>p.verified)}
function resultPassIndexUnlocked(group,index){if(index<=0)return true;return group.passes.slice(0,index).every(p=>p.verified)}
function passResultUnlocked(passId){for(const g of state.results){const i=g.passes.findIndex(p=>p.id===passId);if(i>=0)return resultPassIndexUnlocked(g,i)}return false}
function firstUnlockedResultIndex(){let unlocked=0;for(let i=0;i<state.results.length;i++){unlocked=i;if(!resultGroupVerified(state.results[i]))break}return Math.min(unlocked,Math.max(0,state.results.length-1))}
function resultIndexUnlocked(index){if(index<=0)return true;return state.results.slice(0,index).every(resultGroupVerified)}

function animateOverlay(){return new Promise(resolve=>{
  const ov=$('#calcOverlay'),a=$('#spinDigitA'),b=$('#spinDigitB');ov.classList.remove('hidden');let n=0;const start=performance.now();
  function frame(ts){const t=(ts-start)/1250;n++;a.textContent=String(Math.floor(400+Math.random()*3200)).padStart(4,'0');b.textContent=(Math.random()*.5).toFixed(3);if(t<1)requestAnimationFrame(frame);else{setTimeout(()=>{ov.classList.add('hidden');resolve()},160)}}requestAnimationFrame(frame);
  });}
function renderCalculateReady(){
  const host=$('#calculateChecks');if(!host)return;const s=stockMm(),max=effectiveMaxRpm(),valid=routeStepReady(),limiter=effectiveRpmLimiter();const tail=state.tailstockMode==='on'?'задняя бабка включена':state.tailstockMode==='off'?'без задней бабки':'задняя бабка: авто';host.innerHTML=`<span class="${stockStepReady()?'ok':'need'}">${stockStepReady()?'✓':'!'} ${esc(material().short||material().name)} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм</span><span class="${valid?'ok':'need'}">${valid?'✓':'!'} ${state.route.length} операций · геометрия ${valid?'готова':'не заполнена'}</span><span class="ok">✓ G96 LIMS ${max} об/мин · ${esc(limiter.label)}</span><span class="ok">✓ расчётная мощность ${effectiveSpindlePowerKw()} кВт</span><span class="ok">✓ ${tail}</span>`;
  const preview=$('#calculateRoutePreview');if(preview)preview.innerHTML=state.route.map((r,i)=>{const g=routeGeometry(r),toolReady=routeToolPlanReady(r),rowReady=g.ok&&toolReady,toolSummary=routeToolSummary(r);return `<div class="calculate-route-row ${rowReady?'ok':'need'}"><i>${rowReady?'✓':'!'}</i><span><b>${i+1}. ${esc(operation(r.opId).name)}</b><small>${esc(g.text)}</small></span><em>${esc(toolSummary)}</em></div>`}).join('');
  const title=$('#calculateReadyTitle');if(title)title.textContent=valid?'Готово к запуску':'Нужно закончить операции'
}
$('#toCalculateBtn')?.addEventListener('click',()=>{const bad=state.route.find(r=>!routeGeometry(r).ok||!routeToolPlanReady(r));if(bad){state.routeCursor=state.route.indexOf(bad);toast(`${operation(bad.opId).name}: ${!routeGeometry(bad).ok?routeGeometry(bad).text:'назначь совместимый инструмент для каждого прохода'}`);goStep(5);return}goStep(7)});
$('#calculateAllBtn').addEventListener('click',async()=>{if(!state.route.length){toast('Маршрут пуст');goStep(3);return}const bad=state.route.find(r=>!routeGeometry(r).ok||!routeToolPlanReady(r));if(bad){state.routeCursor=state.route.indexOf(bad);toast(`${operation(bad.opId).name}: ${!routeGeometry(bad).ok?routeGeometry(bad).text:'назначь совместимый инструмент для каждого прохода'}`);goStep(5);return}readStock();state.coolant=$('#coolant').value;state.rigidity=$('#rigidity').value;await animateOverlay();calculateRoute();renderResults(true);goStep(8);saveDraft()});

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
function cutCountLabel(n){n=Math.max(0,Math.round(Number(n)||0));const n10=n%10,n100=n%100;const word=n10===1&&n100!==11?'проход':([2,3,4].includes(n10)&&![12,13,14].includes(n100)?'прохода':'проходов');return `${n} ${word}`}
function sinumerikNote(res){const route=state.route.find(x=>x.uid===res.routeUid),op=operation(res.opId),max=effectiveMaxRpm();let extra='';
  if(res.opId.startsWith('thread'))extra=`Резьба: P ${route.pitch} мм · ориентир ${res.threadPasses} проходов · радиальная глубина профиля ≈ ${res.threadDepth} мм.`;
  else if(res.cutCount>1)extra+=` План съёма: ${cutCountLabel(res.cutCount)} по ap ${res.ap} мм ${res.opId==='face'?'по Z':'на сторону'}.`;
  if(res.tailstock)extra+=` Задняя бабка: Разное → Установки → Задняя бабка = Да; задай XRR. ${state.machine.tailstockMExtend?`OEM подвод: ${state.machine.tailstockMExtend}.`:''}`;
  return `${op.shopturn} ${extra} G96 LIMS для этой сборки: ${max} об/мин (${effectiveRpmLimiter().label}).`;
}
function resultPassHtml(res,idx,locked=false){
  const t=res.tool,trial=res.trial,isMine=t.libraryType==='cupboard',reqs=res.requirements||[];
  const reqHtml=reqs.length?`<div class="result-requirements"><small>ТРЕБОВАНИЯ ЧЕРТЕЖА</small>${reqs.map(r=>`<span>${esc(requirementLabel(r))}${isPrecisionRequirement(r)?' · контроль после чистового':''}</span>`).join('')}</div>`:'';
  const passPlan=res.cutCount>1?`${cutCountLabel(res.cutCount)} · ap ${res.removalPerPass} мм ${res.opId==='face'?'по Z':'на сторону'}`:res.removalTotal!=null?`съём ${res.removalTotal} мм ${res.opId==='face'?'по Z':'на сторону'}`:'';
  const lockNote=locked?`<div class="pass-lock-note"><b>Сначала подтверди предыдущий проход</b><span>Финиш откроется после проверки чернового режима на станке.</span></div>`:'';
  const feedback=locked?'':`<div class="feedback-buttons">${Object.entries(D.feedbackRules).map(([id,r])=>`<button class="${id==='good'?'good':''}" data-feedback="${id}" data-pass="${res.id}">${r.icon} ${r.label}</button>`).join('')}</div><div class="adjust-host" id="adjust-${cssSafe(res.id)}"></div>`;
  return `<div class="pass-block ${locked?'pass-locked':''}" data-pass-id="${res.id}"><div class="pass-head"><b>${passLabel(res.pass)}${passPlan?` · ${passPlan}`:''}</b><span>${res.verified?'✓ подтверждён на станке':locked?'ожидает предыдущий проход':`версия режима ${res.revision+1}`}</span></div>${lockNote}<div class="metric-grid"><div class="metric rpm"><small>S · ШПИНДЕЛЬ</small><b data-anim="${res.rpm}" data-dec="0">0</b><span>об/мин</span></div><div class="metric feed"><small>f · ПОДАЧА</small><b data-anim="${res.f}" data-dec="3">0.000</b><span>мм/об</span></div><div class="metric vc"><small>Vc · ФАКТ.</small><b data-anim="${res.vc}" data-dec="1">0.0</b><span>м/мин</span></div><div class="metric ap"><small>ap · ГЛУБИНА</small><b data-anim="${res.ap}" data-dec="3">0.000</b><span>мм</span></div></div><div class="secondary-metrics"><div><small>Мощность мотора</small><b>${res.power} кВт · ${res.powerPct}%</b></div><div><small>Ra теоретическая</small><b>${res.ra==null?'—':res.ra+' мкм'}</b></div><div><small>Ограничения</small><b>${res.rpmLimited?'лимит оборотов ':''}${res.powerLimited?'лимит мощности':''}${!res.rpmLimited&&!res.powerLimited?'норма':''}</b></div></div>${reqHtml}<div class="tool-recommendation my-tool-card iso-tint" data-iso="${material().iso}"><div class="tool-art real-tool-art">${toolThumbHtml(t,res.id)}${toolSideThumb(t)}</div><div class="tool-copy"><small>${isMine?'МОЙ ИНСТРУМЕНТ':'КАТАЛОГ · НЕТ ПОДТВЕРЖДЁННОГО В ШКАФУ'}</small><b>${esc(t.holder||'Державка не указана')}</b><span>${esc(t.insert)} · ${esc(t.grade)} · ${esc(t.breaker)} · ${noseLabel(t)}<br>${isMine?`${esc(t.location||'ячейка не задана')} · ${t.quantity||0} шт. · ${toolUseText(t)}`:`${esc(t.source)} · добавь/отсканируй свой инструмент, чтобы привязать реальную ячейку`}</span></div></div><div class="sinumerik-box"><div class="sin-head"><span>SIEMENS</span><b>SINUMERIK 828D / ShopTurn</b></div><div class="sin-screen"><div><small>S / LIMS</small><b>${res.rpm}</b></div><div><small>F · G95</small><b>${res.f}</b></div><div><small>Vc · G96</small><b>${res.targetVc}</b></div><div><small>ap</small><b>${res.ap}</b></div></div></div><div class="shopturn-note">${sinumerikNote(res)}</div><div class="trial-zone"><div><div><h4>${res.cutCount>1?'Пробный проход для этого режима':'Первый пробный проход'}</h4><p>${res.cutCount>1?`Если режим стабилен, выполни ${cutCountLabel(res.cutCount)} с этим режимом; последний съём при необходимости будет меньше.`:'Оценка относится только к этой операции и этому проходу.'}</p></div><span class="badge ${res.verified?'green':''}">${res.verified?'ПРОВЕРЕНО':locked?'ОЖИДАЕТ':'СТАРТОВЫЙ РЕЖИМ'}</span></div><div class="trial-mini"><span>S ${trial.rpm} об/мин</span><span>f ${trial.f} мм/об</span><span>ap ${trial.ap} мм</span><span>Vc ${trial.vc} м/мин</span></div>${res.finishOnlyHeavy?`<div class="finish-heavy-warning">! Для чистового режима припуск велик. Лучше добавить черновой проход.</div>`:''}${feedback}</div></div>`;
}
function cssSafe(s){return s.replace(/[^a-zA-Z0-9_-]/g,'_')}
function renderResultFlow(){
  const host=$('#resultOperationNav'),prev=$('#prevResultOpBtn'),next=$('#nextResultOpBtn');if(!host||!state.results.length)return;
  state.resultCursor=clamp(Number(state.resultCursor)||0,0,state.results.length-1);
  host.innerHTML=state.results.map((g,i)=>{const done=resultGroupVerified(g),active=i===state.resultCursor,unlocked=resultIndexUnlocked(i),op=operation(g.opId);return `<button class="result-flow-chip ${active?'active':''} ${done?'done':''} ${unlocked?'':'locked'}" data-result-index="${i}" ${unlocked?'':'disabled'}><i>${done?'✓':unlocked?i+1:'⌕'}</i><span><b>${esc(op?.name||g.name)}</b><small>${done?'проверено':active?'сейчас':'после предыдущей'}</small></span></button>`}).join('');
  host.querySelectorAll('[data-result-index]').forEach(b=>b.addEventListener('click',()=>{const i=+b.dataset.resultIndex;if(!resultIndexUnlocked(i)){toast('Сначала подтверди предыдущую операцию');return}state.resultCursor=i;renderResults()}));
  const current=state.results[state.resultCursor],done=resultGroupVerified(current),last=state.resultCursor===state.results.length-1;
  if(prev){prev.disabled=state.resultCursor===0;prev.textContent='← Предыдущая операция'}
  if(next){next.disabled=!done||last;next.classList.toggle('is-disabled',next.disabled);next.innerHTML=last?(done?'Маршрут проверен ✓':'Подтверди операцию'):'Следующая операция <span>→</span>';next.title=!done?'Отметь «Всё отлично» для каждого прохода этой операции':''}
  const badge=$('#resultCurrentBadge');if(badge)badge.textContent=`Операция ${state.resultCursor+1} из ${state.results.length}`;
}
function renderResults(animate=false){
  const s=stockMm(),m=material();$('#resultSubtitle').textContent=`${m.name} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм · ${state.route.length} операций`;
  $('#resultSummary').innerHTML=`<div class="summary-cell"><small>СТАНОК</small><b>${state.machine.name}</b></div><div class="summary-cell"><small>МАТЕРИАЛ</small><b>${m.short} · ISO ${m.iso}</b></div><div class="summary-cell"><small>ЗАГОТОВКА</small><b>Ø${round(s.diameter,1)} × ${round(s.length,1)} мм</b></div><div class="summary-cell"><small>СТРАТЕГИЯ</small><b>${{safe:'Безопасная',work:'Рабочая',productive:'Производительная'}[state.strategy]}</b></div><div class="summary-cell"><small>ПРОВЕРЕНО</small><b>${verifiedCount()} / ${totalPassCount()} проходов</b></div>`;
  if(!state.results.length){$('#resultsList').innerHTML='';return}
  state.resultCursor=clamp(Number(state.resultCursor)||0,0,state.results.length-1);
  if(!resultIndexUnlocked(state.resultCursor))state.resultCursor=firstUnlockedResultIndex();
  const group=state.results[state.resultCursor],op=operation(group.opId),allOk=resultGroupVerified(group),route=state.route.find(x=>x.uid===group.routeUid);
  $('#resultsList').innerHTML=`<article class="result-card result-card-single glass iso-tint" data-iso="${m.iso}"><div class="result-card-header"><div class="op-number"><b>${String(state.resultCursor+1).padStart(2,'0')}</b></div><div><h3>${op.icon} ${op.name}</h3><p>${route?.pass==='both'?'Черновая + чистовая':passLabel(group.passes[0].pass)} · ${group.passes.length} расчёт(а)</p></div><span class="verified-pill ${allOk?'ok':''}">${allOk?'✓ ПРОВЕРЕНО':'ПРОБНЫЙ ПРОХОД'}</span></div><div class="result-card-body">${group.passes.map((p,j)=>resultPassHtml(p,j,!resultPassIndexUnlocked(group,j))).join('')}</div></article>`;
  renderResultFlow();
  $$('[data-anim]').forEach(el=>animateNumber(el,+el.dataset.anim,+el.dataset.dec));
  $$('[data-feedback]').forEach(b=>b.addEventListener('click',()=>feedbackAction(b.dataset.pass,b.dataset.feedback)));
  const complete=state.results.every(resultGroupVerified),final=$('.final-actions');if(final)final.classList.toggle('route-complete',complete);
  const finalStatus=$('#routeCompleteStatus');if(finalStatus)finalStatus.textContent=complete?'✓ Все операции подтверждены на станке':'Сначала пройди операции по очереди';
  if(animate)syncHeroLive(group.passes[0],true);else syncHeroLive(group.passes[0],false)
}
$('#prevResultOpBtn')?.addEventListener('click',()=>{if(state.resultCursor>0){state.resultCursor--;renderResults();window.scrollTo({top:document.querySelector('.results-panel')?.offsetTop||0,behavior:'smooth'})}});
$('#nextResultOpBtn')?.addEventListener('click',()=>{const g=state.results[state.resultCursor];if(!resultGroupVerified(g)){toast('Сначала подтверди текущую операцию');return}if(state.resultCursor<state.results.length-1){state.resultCursor++;renderResults();window.scrollTo({top:document.querySelector('.results-panel')?.offsetTop||0,behavior:'smooth'})}});
function totalPassCount(){return state.results.reduce((a,g)=>a+g.passes.length,0)}function verifiedCount(){return state.results.reduce((a,g)=>a+g.passes.filter(p=>p.verified).length,0)}
function getPassById(id){for(const g of state.results){const p=g.passes.find(x=>x.id===id);if(p)return p}return null}
function replanResultGroup(passId){
  for(const g of state.results){const i=g.passes.findIndex(x=>x.id===passId);if(i<0)continue;const route=state.route.find(r=>r.uid===g.routeUid);if(!route)return;for(let j=i+1;j<g.passes.length;j++){g.passes[j].verified=false;g.passes[j].lastFeedback=null;g.passes[j].verifiedAt=null}g.passes=annotatePassPlan(route,g.passes);return}
}
function feedbackAction(passId,ruleId){const p=getPassById(passId),rule=D.feedbackRules[ruleId];if(!p)return;if(!passResultUnlocked(passId)){toast('Сначала подтверди предыдущий проход');return}if(ruleId==='good'){p.verified=true;p.lastFeedback='good';p.verifiedAt=new Date().toISOString();const group=state.results[state.resultCursor],completed=resultGroupVerified(group),hasNext=state.resultCursor<state.results.length-1;renderResults();syncHeroLive(p,true);if(completed&&hasNext){toast('Операция подтверждена · открываю следующую');setTimeout(()=>{if(resultGroupVerified(state.results[state.resultCursor])&&state.resultCursor<state.results.length-1){state.resultCursor++;renderResults();window.scrollTo({top:document.querySelector('.results-panel')?.offsetTop||0,behavior:'smooth'})}},650)}else toast(completed?'Операция подтверждена':'Проход подтверждён · проверь следующий');return}
  p.lastFeedback=ruleId;const proposed=deep(p);proposed.rpm=round(p.rpm*rule.mult.rpm);proposed.f=round(p.opId.startsWith('thread')?p.f:clamp(p.f*rule.mult.f,p.range.f[0],p.range.f[2]),3);proposed.ap=round(clamp(p.ap*rule.mult.ap,Math.min(.05,p.range.ap[0]),p.range.ap[2]),3);proposed.vc=round(Math.PI*p.diameter*proposed.rpm/1000,1);proposed.targetVc=proposed.vc;proposed.power=round(p.power*rule.mult.f*rule.mult.ap*rule.mult.rpm,2);proposed.powerPct=round(proposed.power/effectiveSpindlePowerKw()*100);proposed.trial={rpm:round(proposed.rpm*.92),f:round(proposed.opId.startsWith('thread')?proposed.f:proposed.f*.88,3),ap:round(proposed.ap*.62,3),vc:round(Math.PI*p.diameter*(proposed.rpm*.92)/1000,1)};
  const host=$(`#adjust-${cssSafe(passId)}`);host.innerHTML=`<div class="adjust-panel"><h5>${rule.icon} ${rule.label}</h5><p>${rule.reason}</p><div class="adjust-compare"><div><small>S, об/мин</small><del>${p.rpm}</del><b>${proposed.rpm}</b></div><div><small>f, мм/об</small><del>${p.f}</del><b>${proposed.f}</b></div><div><small>ap, мм</small><del>${p.ap}</del><b>${proposed.ap}</b></div><div><small>Vc, м/мин</small><del>${p.vc}</del><b>${proposed.vc}</b></div></div><div class="adjust-actions"><button class="primary" data-apply-adjust="${passId}">Применить новый режим</button><button class="ghost" data-cancel-adjust="${passId}">Отмена</button></div></div>`;
  host.querySelector('[data-apply-adjust]').addEventListener('click',()=>{Object.assign(p,proposed,{verified:false,revision:p.revision+1});replanResultGroup(passId);renderResults();syncHeroLive(p,true);toast('Пересчитано. Число проходов тоже обновлено — сделай новый пробный проход')});host.querySelector('[data-cancel-adjust]').addEventListener('click',()=>host.innerHTML='');
}

function projectPayload(){return{id:state.projectId||uid(),name:$('#projectName').value.trim()||'Без названия',savedAt:new Date().toISOString(),machine:deep(state.machine),materialId:state.materialId,stock:deep(state.stock),route:deep(state.route),selectedToolIds:deep(state.selectedToolIds||[]),requirements:deep(state.requirements||[]),strategy:state.strategy,coolant:state.coolant,rigidity:state.rigidity,tailstockMode:state.tailstockMode,results:deep(state.results),version:D.version}}
function saveCurrentProject(){if(!state.results.length){toast('Сначала рассчитай маршрут');return}const p=projectPayload(),list=projects(),idx=list.findIndex(x=>x.id===p.id);if(idx>=0)list[idx]=p;else list.unshift(p);state.projectId=p.id;saveProjects(list.slice(0,120));toast('Проект сохранён локально')}
['saveProjectBtn','saveProjectTop'].forEach(id=>$('#'+id).addEventListener('click',saveCurrentProject));
function openProject(id){const p=projects().find(x=>x.id===id);if(!p)return;state.projectId=p.id;state.machine=normalizeMachineProfile(p.machine||state.machine);state.materialId=p.materialId;state.stock=p.stock;state.route=(p.route||[]).map(normalizeRouteToolAssignments);state.selectedToolIds=p.selectedToolIds||[];state.requirements=p.requirements||[];state.strategy=p.strategy||'work';state.coolant=p.coolant||'emulsion';state.rigidity=p.rigidity||'medium';state.tailstockMode=['auto','on','off'].includes(p.tailstockMode)?p.tailstockMode:'auto';state.routeCursor=0;state.results=p.results||[];$('#projectName').value=p.name;syncMachineUI();renderMaterials();syncStockUI();renderRoute();syncStrategy();renderRequirements();renderResults();navView('work');goStep(state.results.length?8:5);toast('Проект показан') }
function deleteProject(id){if(!confirm('Удалить проект с этого устройства?'))return;markProjectSync(id,true);saveProjects(projects().filter(x=>x.id!==id));toast('Проект удалён и помечен для синхронизации')}
function renderProjects(){const list=projects(),box=$('#projectsList');if(!list.length){box.innerHTML='<div class="empty-state glass"><b>Проектов пока нет</b><span>Рассчитай техпроцесс и сохрани его — он появится здесь.</span></div>';return}box.innerHTML=list.map(p=>{const m=D.materials.find(x=>x.id===p.materialId),s=p.stock,verified=(p.results||[]).reduce((a,g)=>a+g.passes.filter(x=>x.verified).length,0),total=(p.results||[]).reduce((a,g)=>a+g.passes.length,0);return `<article class="project-card glass"><div><h3>${esc(p.name)}</h3><p>${new Date(p.savedAt).toLocaleString('ru-RU')} · ${m?.name||p.materialId}</p><div class="project-meta"><span>Ø${s.diameter}${s.unit}</span><span>${s.length}${s.unit}</span><span>${p.route?.length||0} операций</span><span>${verified}/${total} проверено</span></div></div><div class="project-actions"><button data-open-project="${p.id}">Показать</button><button data-delete-project="${p.id}">Удалить</button></div></article>`}).join('');box.querySelectorAll('[data-open-project]').forEach(b=>b.addEventListener('click',()=>openProject(b.dataset.openProject)));box.querySelectorAll('[data-delete-project]').forEach(b=>b.addEventListener('click',()=>deleteProject(b.dataset.deleteProject)))}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

function clearToolPurposeChecks(selector='#customOps'){$$(selector+' input').forEach(x=>x.checked=false)}
function newProject(){if(state.route.length||state.results.length){if(!confirm('Начать новый проект? Несохранённые данные будут сброшены.'))return}state.projectId=null;state.materialId='';state.stock={diameter:null,length:null,unit:'mm',hardness:null};state.route=[];state.selectedToolIds=[];state.requirements=[];state.strategy='work';state.coolant='emulsion';state.rigidity='medium';state.tailstockMode='auto';state.routeCursor=0;state.results=[];$('#projectName').value='Новая деталь';clearToolPurposeChecks('#customOps');clearToolPurposeChecks('#customPasses');clearToolPurposeChecks('#scanOps');store.set(KEYS.draft,null);renderMaterials();syncStockUI();renderRoute();renderRequirements();syncStrategy();syncHeroLive(null,false);goStep(1);toast('Новый проект')}
$('#resetDraft').addEventListener('click',newProject);$('#newProjectBtn').addEventListener('click',newProject);

function printProject(){if(!state.results.length){toast('Нет рассчитанного проекта');return}window.print()}
['printProjectBtn','printProjectTop'].forEach(id=>$('#'+id).addEventListener('click',printProject));
function exportPng(){if(!state.results.length){toast('Нет рассчитанного проекта');return}const c=$('#exportCanvas'),ctx=c.getContext('2d'),w=c.width,h=c.height;const grad=ctx.createLinearGradient(0,0,w,h);grad.addColorStop(0,'#071624');grad.addColorStop(1,'#04080d');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);ctx.fillStyle='#6bbaff';ctx.font='700 26px system-ui';ctx.fillText('CNC COPILOT · FULL 3.1.0',70,80);ctx.fillStyle='#f7fbff';ctx.font='800 56px system-ui';ctx.fillText($('#projectName').value||'Техпроцесс',70,155);const s=stockMm(),m=material();ctx.fillStyle='#9db0c0';ctx.font='26px system-ui';ctx.fillText(`${state.machine.name} · ${m.name} · Ø${round(s.diameter,1)} × ${round(s.length,1)} мм`,70,210);let y=285;state.results.slice(0,9).forEach((g,i)=>{ctx.fillStyle='rgba(255,255,255,.07)';roundRect(ctx,60,y-38,1080,125,25);ctx.fill();ctx.fillStyle='#f7fbff';ctx.font='700 28px system-ui';ctx.fillText(`${String(i+1).padStart(2,'0')}  ${operation(g.opId).name}`,85,y);let x=85;g.passes.forEach((p,j)=>{ctx.fillStyle=j?'#86e2b2':'#8fcaff';ctx.font='600 20px system-ui';ctx.fillText(`${passLabel(p.pass)}: S ${p.rpm}  f ${p.f}  Vc ${p.vc}  ap ${p.ap}${p.verified?'  ✓':''}`,x,y+42+j*31)});y+=145});ctx.fillStyle='#71879a';ctx.font='18px system-ui';ctx.fillText('Стартовая технологическая рекомендация. Проверяй зажим, траекторию, нули и лимиты станка.',70,h-70);c.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`CNC-${safeName($('#projectName').value)}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)},'image/png')}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):(ctx.rect(x,y,w,h));}
function safeName(s){return String(s||'project').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g,'_').slice(0,60)}
$('#exportPngBtn').addEventListener('click',exportPng);

function toolLibraryCardHtml(t){return `<article class="tool-card-ui glass iso-tint ${t.libraryType==='cupboard'?'mine':''}" data-iso="${t.iso?.[0]||'P'}"><div class="tool-art real-tool-art">${toolThumbHtml(t,t.id)}${toolSideThumb(t)}</div><div class="tool-card-copy"><div class="tool-card-top"><span class="badge ${t.libraryType==='cupboard'?'green':''}">${t.libraryType==='cupboard'?'МОЙ ШКАФ':'КАТАЛОГ'}</span>${t.libraryType==='cupboard'?`<span class="stock-pill">${esc(t.location||'без ячейки')} · ${t.quantity||0} шт.</span>`:''}</div><h3>${esc(t.holder||'Державка не указана')}</h3><p><b>${esc(t.insert)}</b> · ${esc(t.grade)} · ${esc(t.breaker)} · ${noseLabel(t)}</p><div class="tool-tags"><span>ISO ${(t.iso||[]).join('/')}</span><span>${esc(toolUseText(t))}</span><span>${esc(toolPassText(t))}</span></div>${isoDotsHtml(t)}${toolNeedsPassProfile(t)?`<div class="tool-pass-profile ${t.passProfileConfirmed===false?'need':''}"><small>${t.passProfileConfirmed===false?'Подтверди назначение прохода':'Назначение прохода подтверждено'}</small><button data-tool-passprofile="${t.id}" data-mode="rough">Черн.</button><button data-tool-passprofile="${t.id}" data-mode="finish">Чист.</button><button data-tool-passprofile="${t.id}" data-mode="both">Оба</button></div>`:''}${t.libraryType==='cupboard'?`<div class="tool-local-actions"><button data-tool-qty="${t.id}" data-delta="1">+1</button><button data-tool-qty="${t.id}" data-delta="-1">−1</button><button data-tool-delete="${t.id}">Удалить</button></div>`:''}</div></article>`}
function renderTools(){
  const q=($('#toolSearch')?.value||'').trim().toLowerCase(),iso=$('#toolIsoFilter')?.value||'all';
  const filter=t=>(iso==='all'||t.iso.includes(iso))&&(!q||[t.holder,t.insert,t.grade,t.breaker,t.location,t.manufacturer].join(' ').toLowerCase().includes(q));
  const mine=cupboardTools().filter(filter),catalog=D.tools.map(t=>({...t,libraryType:'catalog',quantity:t.quantity||null,location:t.location||'',photos:t.photos||{}})).filter(filter);
  const mineHost=$('#toolLibraryMine'),catalogHost=$('#toolLibraryCatalog');
  if(mineHost)mineHost.innerHTML=mine.length?mine.map(toolLibraryCardHtml).join(''):'<div class="empty-state glass tool-empty"><b>Мой шкаф пока пуст</b><span>Отсканируй коробку или добавь инструмент вручную. Каталог ниже останется только запасным источником.</span></div>';
  if(catalogHost)catalogHost.innerHTML=catalog.length?catalog.map(toolLibraryCardHtml).join(''):'<div class="empty-state glass tool-empty"><b>В каталоге ничего не найдено</b><span>Измени поиск или ISO-фильтр.</span></div>';
  const mineCount=$('#toolMineCount'),catalogCount=$('#toolCatalogCount');if(mineCount)mineCount.textContent=`${mine.length} позиций`;if(catalogCount)catalogCount.textContent=`${catalog.length} позиций`;
  $$('[data-tool-qty]').forEach(b=>b.addEventListener('click',()=>{const list=cupboardTools(),t=list.find(x=>x.id===b.dataset.toolQty);if(!t)return;t.quantity=Math.max(0,(t.quantity||0)+(+b.dataset.delta));saveCupboard(list);toast(`${t.insert}: ${t.quantity} шт.`)}));
  $$('[data-tool-passprofile]').forEach(b=>b.addEventListener('click',()=>setToolPassProfile(b.dataset.toolPassprofile,b.dataset.mode)));
  $$('[data-tool-delete]').forEach(b=>b.addEventListener('click',()=>{const t=cupboardTools().find(x=>x.id===b.dataset.toolDelete);if(!t)return;if(!confirm(`Удалить ${t.insert} из шкафа?`))return;state.selectedToolIds=(state.selectedToolIds||[]).filter(x=>x!==t.id);markToolSync(t,true);saveCupboard(cupboardTools().filter(x=>x.id!==t.id));toast('Инструмент удалён и помечен для синхронизации')}));
}
$('#toolSearch')?.addEventListener('input',renderTools);$('#toolIsoFilter')?.addEventListener('change',renderTools);

async function compressImage(file,maxSide=900,quality=.72){return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale)),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);URL.revokeObjectURL(url);resolve(c.toDataURL('image/jpeg',quality))};img.onerror=e=>{URL.revokeObjectURL(url);reject(e)};img.src=url})}
async function filePhoto(id){const f=$('#'+id)?.files?.[0];return f?compressImage(f,760,.68):''}
$('#addCustomTool').addEventListener('click',async()=>{const holder=$('#customHolder').value.trim(),insert=$('#customInsert').value.trim();if(!insert){toast('Укажи маркировку пластины');return}const ops=$$('#customOps input:checked').map(x=>x.value),passOps=ops.some(x=>['face','od','bore'].includes(x)),cutPasses=$$('#customPasses input:checked').map(x=>x.value);if(passOps&&!cutPasses.length){toast('Укажи: черновой, чистовой или оба прохода');return}const passes=[...(cutPasses||[]),...(ops.some(x=>!['face','od','bore'].includes(x))?['single']:[])];const front=await filePhoto('customPhotoFront'),side=await filePhoto('customPhotoSide');const tool=normalizeTool({id:'custom-'+uid(),holder:holder||'Державка не указана',insert,grade:$('#customGrade').value.trim()||'не задан',breaker:$('#customBreaker').value.trim()||'—',nose:$('#customNose').value.trim()===''?'':+$('#customNose').value,iso:[$('#customIso').value],isoPriority:{[$('#customIso').value]:'primary'},ops,passes,passProfileConfirmed:true,passProfileRevision:1,source:'Добавлено вручную',verified:true,quantity:$('#customQuantity').value.trim()===''?1:+$('#customQuantity').value,location:$('#customLocation').value.trim(),libraryType:'cupboard',photos:{front,side},art:{shape:shapeFromInsert(insert),tone:'steel'}});const list=cupboardTools();const dup=list.find(x=>x.canonicalKey===tool.canonicalKey);if(dup){dup.quantity+=(tool.quantity||1);dup.ops=[...new Set([...(dup.ops||[]),...(tool.ops||[])])];dup.passes=[...new Set([...(dup.passes||[]),...(tool.passes||[])])];dup.passProfileConfirmed=true;dup.passProfileRevision=1;if(!dup.photos?.front&&front)dup.photos.front=front;if(!dup.photos?.side&&side)dup.photos.side=side;if(saveCupboard(list))toast(`Уже было в ${dup.location||'шкафу'} · количество ${dup.quantity}`);return}list.push(tool);if(saveCupboard(list)){clearToolPurposeChecks('#customOps');clearToolPurposeChecks('#customPasses');toast('Инструмент добавлен в локальный шкаф')}});

let scannerImages=[],scannerStoredImages=[],scannerDuplicateId=null,scannerForceNew=false,scannerAnalysis={};
function openScanner(){scannerImages=[];scannerStoredImages=[];scannerDuplicateId=null;scannerForceNew=false;scannerAnalysis={};clearToolPurposeChecks('#scanPasses');$('#scanPreview').innerHTML='<div class="scan-empty"><span>⌾</span><b>Добавь фото коробки</b><small>Родная коробка — обычно достаточно этикетки. Если есть сомнение, добавь лицо и торец пластинки.</small></div>';$('#scanForm').classList.add('hidden');$('#scanDuplicate').classList.add('hidden');setScanStatus('Готов к сканированию','ready');$('#scannerModal').classList.remove('hidden');$('#scannerModal').setAttribute('aria-hidden','false');document.body.classList.add('modal-open')}
function closeScanner(){$('#scannerModal').classList.add('hidden');$('#scannerModal').setAttribute('aria-hidden','true');document.body.classList.remove('modal-open')}
$('#openScanner')?.addEventListener('click',openScanner);$('#closeScanner')?.addEventListener('click',closeScanner);$('#scannerModal')?.addEventListener('click',e=>{if(e.target.id==='scannerModal')closeScanner()});
function setScanStatus(text,mode='ready'){const el=$('#scanStatus');el.dataset.mode=mode;el.querySelector('span').textContent=text}
async function scannerFilesSelected(files){const arr=[...files].slice(0,4);scannerImages=[];scannerStoredImages=[];setScanStatus('Готовлю изображения…','working');for(const f of arr){try{const [ai,small]=await Promise.all([compressImage(f,1800,.84),compressImage(f,760,.64)]);scannerImages.push(ai);scannerStoredImages.push(small)}catch{}}renderScanPreview();setScanStatus(scannerImages.length?`${scannerImages.length} фото готово к распознаванию`:'Не удалось прочитать фото',scannerImages.length?'ready':'error')}
$('#scannerCamera')?.addEventListener('change',e=>scannerFilesSelected(e.target.files));$('#scannerGallery')?.addEventListener('change',e=>scannerFilesSelected(e.target.files));
function renderScanPreview(){$('#scanPreview').innerHTML=scannerImages.length?scannerImages.map((src,i)=>`<div class="scan-shot"><img src="${src}" alt="Фото ${i+1}"><small>${i===0?'коробка/этикетка':i===1?'лицо пластинки':i===2?'торец пластинки':'доп. фото'}</small></div>`).join(''):'<div class="scan-empty"><span>⌾</span><b>Фото не выбраны</b></div>'}
function parseToolText(text=''){const up=text.toUpperCase(),insert=(up.match(/\b(?:W|D|C|T|V|S|R|M)[CNPGDA][A-Z]{1,2}\s*\d{4,6}(?:[- ][A-Z0-9]{1,5})?/i)||up.match(/\bMGMN\s*\d{3,4}(?:[- ][A-Z0-9]{1,5})?/i)||[])[0]||'',r=(up.match(/R\s*([0-9]+(?:[.,][0-9]+)?)/)||[])[1],grades=(up.match(/\b(?:PT|PC|CT|GC|KC|IC|VP|TN|CP|PR|AC|TT|MC)\d{3,5}[A-Z]*\b/g)||[]);return {manufacturer:'',insert:insert.trim(),grade:grades[0]||'',breaker:(insert.split('-')[1]||''),nose:r?+r.replace(',','.'):null,iso:[],operations:[],confidence:.35,evidence:text}}
async function nativeTextScan(){if(!('TextDetector'in window)||!scannerImages.length)return null;try{const det=new TextDetector(),img=new Image();img.src=scannerImages[0];await img.decode();const bmp=await createImageBitmap(img),blocks=await det.detect(bmp);return parseToolText(blocks.map(b=>b.rawValue).join('\n'))}catch{return null}}
function scanPayloadToForm(d){d=d||{};scannerAnalysis=d;$('#scanManufacturer').value=d.manufacturer||'';$('#scanInsert').value=d.insert||d.designation||'';$('#scanGrade').value=d.grade||'';$('#scanBreaker').value=d.breaker||d.chipbreaker||'';$('#scanNose').value=d.nose_radius_mm??d.nose??'';$('#scanQuantity').value=d.quantity||1;$('#scanLocation').value=d.location||'';$('#scanHolder').value=d.holder||d.holder_compatibility||'';$('#scanEvidence').value=[d.evidence,d.notes,Number.isFinite(+d.confidence)?`Уверенность: ${Math.round(+d.confidence*100)}%`:null].filter(Boolean).join('\n');const groups=[...(d.iso||d.material_groups||[])];Object.entries(d.iso_priority||{}).forEach(([k,v])=>{if(v&&v!=='off')groups.push(k)});const iso=new Set(groups.map(x=>String(x).toUpperCase()));$$('#scanForm .iso-scan-row input').forEach(x=>x.checked=iso.has(x.value));const ops=new Set((d.operations||[]).map(String));$$('#scanOps input').forEach(x=>x.checked=ops.has(x.value));clearToolPurposeChecks('#scanPasses');$('#scanForm').classList.remove('hidden');checkScannerDuplicate()}
function scanFormTool(){const iso=$$('#scanForm .iso-scan-row input:checked').map(x=>x.value),ops=$$('#scanOps input:checked').map(x=>x.value),cutPasses=$$('#scanPasses input:checked').map(x=>x.value),passes=[...cutPasses,...(ops.some(x=>!['face','od','bore'].includes(x))?['single']:[])],insert=$('#scanInsert').value.trim(),noseRaw=$('#scanNose').value.trim();return normalizeTool({id:'scan-'+uid(),manufacturer:$('#scanManufacturer').value.trim(),holder:$('#scanHolder').value.trim()||'Державка не указана',insert,grade:$('#scanGrade').value.trim(),breaker:$('#scanBreaker').value.trim(),nose:noseRaw===''?'':+noseRaw,iso,isoPriority:scannerAnalysis.iso_priority||{},ops,passes,passProfileConfirmed:true,passProfileRevision:1,quantity:+$('#scanQuantity').value||1,location:$('#scanLocation').value.trim(),source:'ИИ-сканер · подтверждено пользователем',verified:true,libraryType:'cupboard',photos:{box:scannerStoredImages[0]||'',front:scannerStoredImages[1]||'',side:scannerStoredImages[2]||''},art:{shape:shapeFromInsert(insert),tone:'steel'}})}
function checkScannerDuplicate(){const tool=scanFormTool(),dup=cupboardTools().find(x=>x.canonicalKey===tool.canonicalKey);scannerDuplicateId=dup?.id||null;scannerForceNew=false;const box=$('#scanDuplicate');if(!dup){box.classList.add('hidden');$('#saveScannedTool').textContent='Подтвердить и добавить';return}box.classList.remove('hidden');box.innerHTML=`<div><b>Такая пластинка уже есть</b><span>${esc(dup.insert)} · ${esc(dup.grade)} · ${esc(dup.breaker)}<br>${esc(dup.location||'ячейка не задана')} · ${dup.quantity||0} шт.</span></div><button id="forceSeparateTool" type="button">Это другая</button>`;$('#saveScannedTool').textContent='Добавить количество к существующей';$('#forceSeparateTool').addEventListener('click',()=>{scannerForceNew=true;scannerDuplicateId=null;box.innerHTML='<div><b>Будет создана отдельная карточка</b><span>Проверь маркировку и ячейку перед сохранением.</span></div>';$('#saveScannedTool').textContent='Создать отдельную карточку'})}
['scanInsert','scanGrade','scanBreaker','scanNose'].forEach(id=>$('#'+id)?.addEventListener('input',checkScannerDuplicate));
$('#runScanner')?.addEventListener('click',async()=>{if(!scannerImages.length){toast('Сначала добавь фото');return}setScanStatus('ИИ читает маркировку и сверяет поля…','working');$('#runScanner').disabled=true;try{let r=await fetch('./api/scan-insert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images:scannerImages,mode:'strict_insert_scan'})});if(!r.ok)throw new Error(await r.text());const d=await r.json();scanPayloadToForm(d);setScanStatus('Распознавание готово · проверь карточку','done')}catch(err){const local=await nativeTextScan();if(local){scanPayloadToForm(local);setScanStatus('Использовано локальное распознавание текста браузером · обязательно проверь поля','warn')}else{scanPayloadToForm({iso:[],operations:[],evidence:'Сервер распознавания недоступен. Фото сохранены; заполни маркировку вручную и подтверди. Для ИИ-сканирования настрой сервер и переменную OPENAI_API_KEY.'});setScanStatus('ИИ-распознавание недоступно · ручное подтверждение','error')}}finally{$('#runScanner').disabled=false}});
$('#saveScannedTool')?.addEventListener('click',()=>{const rawOps=$$('#scanOps input:checked').map(x=>x.value),rawPasses=$$('#scanPasses input:checked').map(x=>x.value);if(rawOps.some(x=>['face','od','bore'].includes(x))&&!rawPasses.length){toast('Подтверди: пластина черновая, чистовая или подходит для обоих режимов');return}const tool=scanFormTool();if(!tool.insert){toast('Маркировка пластины не распознана');return}const list=cupboardTools();if(scannerDuplicateId&&!scannerForceNew){const dup=list.find(x=>x.id===scannerDuplicateId);if(dup){dup.quantity=(dup.quantity||0)+(tool.quantity||1);dup.location=dup.location||tool.location;dup.ops=[...new Set([...(dup.ops||[]),...(tool.ops||[])])];dup.passes=[...new Set([...(dup.passes||[]),...(tool.passes||[])])];dup.passProfileConfirmed=true;dup.passProfileRevision=1;dup.photos=dup.photos||{};['box','front','side'].forEach(k=>{if(!dup.photos[k]&&tool.photos[k])dup.photos[k]=tool.photos[k]});if(saveCupboard(list)){closeScanner();toast(`Уже есть · теперь ${dup.quantity} шт. в ${dup.location||'шкафу'}`)}return}}tool.canonicalKey=canonicalToolKey(tool);list.push(tool);if(saveCupboard(list)){closeScanner();toast('Пластинка добавлена в мой шкаф')}});
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
$('#importBackup').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const data=JSON.parse(rd.result);if(data.machine){state.machine=normalizeMachineProfile(data.machine);store.set(KEYS.machine,state.machine)}if(Array.isArray(data.customTools))store.set(KEYS.tools,data.customTools);if(Array.isArray(data.projects))store.set(KEYS.projects,data.projects);syncMachineUI();renderTools();renderProjects();toast('Резервная копия импортирована')}catch{toast('Не удалось прочитать JSON')}};rd.readAsText(f)});
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),600)}

function syncStrategy(){$$('#strategySwitch [data-strategy]').forEach(b=>b.classList.toggle('active',b.dataset.strategy===state.strategy));$('#coolant').value=state.coolant;$('#rigidity').value=state.rigidity}
function initOfflineStatus(){const label=$('#offlineLabel');if(label)label.textContent='ЛОКАЛЬНОЕ ЯДРО · ГОТОВО'}
function registerSW(){if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).catch(()=>{}))}
window.CNC_APP={
  toast,
  getSyncPayload(){return {version:'3.1.0',machine:normalizeMachineProfile(store.get(KEYS.machine,state.machine)),tools:store.get(KEYS.tools,[]),projects:store.get(KEYS.projects,[]),draft:store.get(KEYS.draft,null),syncMarks:store.get(KEYS.syncMarks,{tools:{},projects:{}}),updatedAt:new Date().toISOString()}},
  applySyncPayload(payload={}){
    try{
      if(payload.machine){state.machine=normalizeMachineProfile(payload.machine);localStorage.setItem(KEYS.machine,JSON.stringify(state.machine))}
      if(Array.isArray(payload.tools))localStorage.setItem(KEYS.tools,JSON.stringify(payload.tools));
      if(Array.isArray(payload.projects))localStorage.setItem(KEYS.projects,JSON.stringify(payload.projects));
      if(payload.syncMarks&&typeof payload.syncMarks==='object')localStorage.setItem(KEYS.syncMarks,JSON.stringify(payload.syncMarks));
    }catch(e){console.warn('CNC sync apply failed',e)}
    syncMachineUI();renderTools();renderProjects();renderRoute();renderProcessToolTray();
  }
};

function init(){initTheme();initAdaptiveDock();syncMachineUI();renderMaterials();syncStockReveal();syncStockUI();renderOperationCatalog();renderRoute();syncTailstockUI();syncStrategy();renderPreflight();renderCalculateReady();renderTools();renderProjects();renderReference();initOfflineStatus();syncHeroLive(firstResultPass(),false);goStep(state.step||1,false);registerSW();}
init();
})();
