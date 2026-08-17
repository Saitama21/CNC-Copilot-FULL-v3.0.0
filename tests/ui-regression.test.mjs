import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const cloud = await readFile(new URL('../public/cloud.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../public/manifest-v306.webmanifest', import.meta.url), 'utf8'));

test('v3 exposes explicit local and online modes', () => {
  assert.match(html, /data-v3-mode="local"/);
  assert.match(html, /data-v3-mode="online"/);
  assert.match(html, /id="v3OnlineToggle"/);
  assert.match(cloud, /function setMode\(on\)/);
});

test('local core never routes API requests through service worker', () => {
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /cnc-copilot-full-v310-wip08/);
});

test('AI scan is blocked until online mode is explicitly enabled', () => {
  assert.match(cloud, /#runScanner/);
  assert.match(cloud, /if\s*\(\s*!connected\s*\)/);
  assert.match(cloud, /ИИ выключен/);
});

test('passkey authentication and offline trusted-device unlock are present', () => {
  assert.match(html, /Face ID \/ Passkey/);
  assert.match(cloud, /navigator\.credentials\.get/);
  assert.match(cloud, /cncV3TrustedProfile/);
  assert.match(cloud, /verifyOfflineAssertion/);
  assert.match(cloud, /crypto\.subtle\.verify/);
  assert.match(cloud, /userVerification\s*:\s*['"]required['"]/);
});

test('smart cupboard and projects are included in cloud sync payload', () => {
  assert.match(app, /getSyncPayload\(\)/);
  assert.match(app, /tools\s*:\s*store\.get\(KEYS\.tools/);
  assert.match(app, /projects\s*:\s*store\.get\(KEYS\.projects/);
  assert.match(cloud, /function merge\(local,\s*remote\)/);
});



test('удаление инструмента и проекта синхронизируется как удаление, а не воскресает из облака', () => {
  assert.match(app, /syncMarks:'cncFullSyncMarksV1'/);
  assert.match(app, /markToolSync\(t,true\)/);
  assert.match(app, /markProjectSync\(id,true\)/);
  assert.match(app, /syncMarks:store\.get\(KEYS\.syncMarks/);
  assert.match(cloud, /function mergeMarkMap\(remote = \{\}, local = \{\}\)/);
  assert.match(cloud, /!toolMarks\[key\]\?\.deleted/);
  assert.match(cloud, /!projectMarks\[key\]\?\.deleted/);
  assert.match(cloud, /cncFullSyncMarksV1/);
});

test('adaptive bottom dock from FULL 1.1.2 is preserved', () => {
  assert.match(app, /function initAdaptiveDock\(\)/);
  assert.match(app, /dock-collapsed/);
  assert.match(css, /body > \.bottom-nav\.glass\.dock-collapsed/);
  assert.match(html, /<nav class="bottom-nav glass mobile-only">/);
});

test('multi-operation and multi-tool workflow remains present', () => {
  assert.match(html, /id="operationCatalog"/);
  assert.match(html, /Мультивыбор из шкафа/);
  assert.match(html, /id="processToolTray"/);
  assert.match(app, /selectedToolIds/);
});

test('material color cards and three theme modes remain present', () => {
  assert.match(html, /id="materialGrid"/);
  assert.match(app, /themeModes=\['system','light','dark'\]/);
  assert.match(css, /html\[data-theme="light"\]/);
});



test('пользовательские статусы и единицы измерения остаются на русском', () => {
  const ui = `${html}
${app}
${cloud}`;
  for (const forbidden of [
    'ONLINE FUNCTIONS', 'OFFLINE CORE', 'LOCAL READY', '● READY',
    '>editable<', '>local<', '>offline<', 'SAFE START',
    'RPM limit', 'Power limit', 'AI выключен', 'AI endpoint',
    '100% local', 'operator check', 'Local-first / Online on demand'
  ]) assert.equal(ui.includes(forbidden), false, `найдена английская пользовательская строка: ${forbidden}`);
  assert.match(html, /ЛОКАЛЬНОЕ ЯДРО · ГОТОВО/);
  assert.match(cloud, /ОНЛАЙН-ФУНКЦИИ · АКТИВНЫ/);
  assert.match(app, /об\/мин/);
  assert.match(app, /мм\/об/);
  assert.match(app, /м\/мин/);
  assert.equal(manifest.lang, 'ru');
});


test('новый расчёт не выбирает назначение инструмента автоматически', () => {
  const customOps = html.match(/<div class="operation-checks" id="customOps">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.equal(/type="checkbox"[^>]*checked/.test(customOps), false, 'в ручной форме не должно быть предвыбранных операций');
  assert.equal(app.includes("ops:ops.length?ops:['face','od']"), false, 'нельзя автоматически подставлять торцовку и наружку');
  assert.match(app, /function clearToolPurposeChecks\(selector=/);
  assert.match(app, /function newProject\(\)[\s\S]*clearToolPurposeChecks\('#customOps'\)[\s\S]*clearToolPurposeChecks\('#scanOps'\)/);
});

test('manifest identifies the 3.0 application', () => {
  assert.match(manifest.name, /3\.0/);
  assert.equal(manifest.display, 'standalone');
});


test('iOS home-screen icon uses versioned cache-busting URLs', () => {
  assert.match(html, /apple-touch-icon-v306-180\.png/);
  assert.match(html, /apple-touch-icon-precomposed/);
  assert.match(html, /manifest-v306\.webmanifest/);
  assert.equal(manifest.icons[0].src, './pwa-icon-v306-192.png');
  assert.equal(manifest.icons[1].src, './pwa-icon-v306-512.png');
});

test('3.1 operation geometry uses drawing language instead of demo target values', () => {
  assert.match(app, /Сырьё \/ было Ø, мм/);
  assert.match(app, /По чертежу \/ должно стать Ø, мм/);
  assert.match(app, /Укажи целевой Ø по чертежу/);
  assert.equal(app.includes('targetDiameter:round(s.diameter*.86,2)'), false, 'новая операция не должна придумывать Ø после');
  assert.equal(app.includes("pitch:2,width:3,threadSize:'M16'"), false, 'геометрия операции не должна стартовать с демо-размерами');
});

test('3.1 blocks strategy until each selected operation has valid geometry', () => {
  assert.match(app, /function routeStepReady\(\)/);
  assert.match(app, /state\.route\.every\(r=>routeGeometry\(r\)\.ok&&routeToolPlanReady\(r\)\)/);
  assert.match(app, /Для наружного точения целевой Ø должен быть меньше исходного/);
  assert.match(app, /Для расточки целевой Ø должен быть больше исходного/);
  assert.match(app, /Заполни геометрию операции/);
});

test('3.1 Guided Workflow splits the job into eight dedicated stages', () => {
  for (let step = 1; step <= 8; step += 1) assert.match(html, new RegExp(`data-step-panel="${step}"`));
  assert.match(html, /GUIDED WORKFLOW/);
  assert.match(html, /Шаг 1 из 8/);
  assert.match(html, /ОПЕРАЦИИ/);
  assert.match(html, /ИНСТРУМЕНТ/);
  assert.match(html, /РАЗМЕРЫ ПО ОПЕРАЦИЯМ/);
  assert.match(html, /СТРАТЕГИЯ И ПРОВЕРКА/);
  assert.match(html, /07 · РАСЧЁТ/);
  assert.match(html, /08 · РЕЗУЛЬТАТ/);
});

test('3.1 operation setup is one card at a time instead of one long route', () => {
  assert.match(app, /routeCursor/);
  assert.match(app, /function renderRouteQueue\(\)/);
  assert.match(app, /Операция \$\{i\+1\} из \$\{n\}/);
  assert.match(app, /Следующая операция/);
  assert.match(html, /id="routeQueue"/);
});

test('3.1 tailstock is an explicit route condition with auto mode', () => {
  assert.match(html, /id="tailstockSwitch"/);
  assert.match(html, /data-tailstock-mode="auto"/);
  assert.match(html, /data-tailstock-mode="on"/);
  assert.match(html, /data-tailstock-mode="off"/);
  assert.match(app, /state\.tailstockMode==='on'/);
  assert.match(app, /state\.tailstockMode==='off'/);
});

test('3.1 hardness is optional when the actual stock dimensions are known', () => {
  assert.match(app, /function stockStepReady\(\)\{const s=stockMm\(\);return !!state\.materialId&&s\.diameter>0&&s\.length>0\}/);
  assert.match(app, /твёрдость можно оставить пустой/);
});


test('3.1 WIP-04 uses verified CK52PT-Y nameplate profile instead of the 11 kW placeholder', async () => {
  const data = await readFile(new URL('../public/data.js', import.meta.url), 'utf8');
  assert.match(data, /1PH8137-1DD02-0CA1/);
  assert.match(data, /spindleKw:17/);
  assert.match(data, /maxTorqueNm:405/);
  assert.match(data, /maxRpm:8000/);
  assert.match(data, /BK-1552/);
  assert.match(data, /maxRpm:6000/);
  assert.match(data, /SINAMICS S120 Combi/);
  assert.equal(/spindleKw:11/.test(data), false);
});

test('3.1 WIP-04 computes effective G96 LIMS from machine, hydraulic cylinder, motor and setup caps', () => {
  assert.match(app, /function rpmConstraints\(\)/);
  assert.match(app, /гидроцилиндр/);
  assert.match(app, /текущий патрон\/кулачки/);
  assert.match(app, /function effectiveRpmLimiter\(\)/);
  assert.match(app, /G96 LIMS/);
  assert.match(html, /Подтверждённое железо · со шильдиков/);
  assert.match(html, /Мощность для расчёта, кВт/);
});


test('3.1 WIP-05 result workflow reveals one operation at a time', () => {
  assert.match(app, /resultCursor/);
  assert.match(app, /function resultGroupVerified\(group\)/);
  assert.match(app, /function resultIndexUnlocked\(index\)/);
  assert.match(app, /const group=state\.results\[state\.resultCursor\]/);
  assert.match(html, /id="resultOperationNav"/);
  assert.match(html, /id="prevResultOpBtn"/);
  assert.match(html, /id="nextResultOpBtn"/);
});

test('3.1 WIP-05 next result operation is gated by real machine confirmation', () => {
  assert.match(app, /Отметь «Всё отлично» для каждого прохода этой операции/);
  assert.match(app, /if\(!resultGroupVerified\(g\)\)\{toast\('Сначала подтверди текущую операцию'\)/);
  assert.match(app, /Операция подтверждена · открываю следующую/);
  assert.match(html, /Следующая откроется только после подтверждения текущей/);
});

test('3.1 WIP-05 feedback recalculates the current pass in place', () => {
  assert.match(app, /Применить новый режим/);
  assert.match(app, /Пересчитано\. (Число проходов тоже обновлено — )?сделай новый пробный проход/i);
  assert.match(app, /verified:false,revision:p\.revision\+1/);
});

test('3.1 WIP-06 Guided Workflow has native-like progress chrome and directional stage transitions', () => {
  assert.match(html, /id="stepProgressBar"/);
  assert.match(html, /id="stepStageName"/);
  assert.match(app, /const STEP_META=/);
  assert.match(app, /function syncGuidedChrome\(/);
  assert.match(app, /stage-enter-forward/);
  assert.match(app, /stage-enter-back/);
  assert.match(app, /scrollIntoView/);
});

test('3.1 WIP-06 reveals actual stock dimensions only after material selection', () => {
  assert.match(html, /id="materialGateHint"/);
  assert.match(html, /id="stockReveal"/);
  assert.match(app, /function syncStockReveal\(\)/);
  assert.match(app, /reveal\.classList\.toggle\('ready',ready\)/);
  assert.match(html, /ФАКТИЧЕСКАЯ ЗАГОТОВКА/);
});

test('3.1 WIP-06 keeps reduced-motion accessibility for guided animations', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /guidedStageForward/);
  assert.match(css, /catalogCascade/);
  assert.match(css, /stock-reveal\.ready/);
});


test('3.1 WIP-07 locks future operation setup until previous geometry is complete', () => {
  assert.match(app, /function routeSetupIndexUnlocked\(index\)/);
  assert.match(app, /Сначала закончи предыдущую операцию/);
  assert.match(app, /route-queue-chip[^`]*locked/);
});

test('3.1 WIP-07 converts stock removal into a physical pass plan', () => {
  assert.match(app, /function routeStockRemoval\(route\)/);
  assert.match(app, /function annotatePassPlan\(route,passes\)/);
  assert.match(app, /function applyPlannedAp\(pass,plannedAp\)/);
  assert.match(app, /cutCount/);
  assert.match(app, /removalPerPass/);
});

test('3.1 WIP-07 requires roughing verification before finishing feedback', () => {
  assert.match(app, /function resultPassIndexUnlocked\(group,index\)/);
  assert.match(app, /function passResultUnlocked\(passId\)/);
  assert.match(app, /Сначала подтверди предыдущий проход/);
  assert.match(app, /pass-locked/);
});

test('3.1 WIP-07 shows route recap and tailstock centering warning before calculation', () => {
  assert.match(html, /id="calculateRoutePreview"/);
  assert.match(app, /calculate-route-row/);
  assert.match(app, /routeToolSummary/);
  assert.match(app, /Задняя бабка планируется, но в маршруте нет центровки/);
});

test('3.1 WIP-07 replans pass count after an in-machine correction', () => {
  assert.match(app, /function replanResultGroup\(passId\)/);
  assert.match(app, /replanResultGroup\(passId\)/);
  assert.match(app, /Число проходов тоже обновлено/);
});

test('3.1 WIP-08 keeps roughing and finishing tool assignments separate', () => {
  assert.match(app, /roughToolId:'auto'/);
  assert.match(app, /finishToolId:'auto'/);
  assert.match(app, /function routeToolChoice\(route,pass\)/);
  assert.match(app, /Черновой инструмент/);
  assert.match(app, /Чистовой инструмент/);
});

test('3.1 WIP-08 never substitutes a rough-only tool into a finishing pass', () => {
  assert.match(app, /function toolSupportsPass\(t,pass\)/);
  assert.match(app, /toolSupportsPass\(t,pass\)/);
  assert.match(app, /Черновой инструмент никогда не подменяет чистовой/);
  assert.match(app, /return fallback\[0\]\|\|null/);
});

test('3.1 WIP-08 requires an explicit pass profile for manually stored turning tools', () => {
  assert.match(html, /id="customPasses"/);
  assert.match(html, /id="scanPasses"/);
  assert.match(app, /Укажи: черновой, чистовой или оба прохода/);
  assert.match(app, /Подтверди: пластина черновая, чистовая или подходит для обоих режимов/);
});

test('3.1 WIP-08 blocks workflow when a required pass has no compatible tool', () => {
  assert.match(app, /function routeToolPlanReady\(route\)/);
  assert.match(app, /назначь совместимый инструмент для каждого прохода/);
  assert.match(app, /routeGeometry\(r\)\.ok&&routeToolPlanReady\(r\)/);
});

test('3.1 WIP-08 does not silently trust legacy cupboard rough-finish metadata', () => {
  assert.match(app, /legacyLocalPassProfile/);
  assert.match(app, /passProfileConfirmed:t\.passProfileConfirmed\?\?!legacyLocalPassProfile/);
  assert.match(app, /function setToolPassProfile\(id,mode\)/);
  assert.match(app, /data-tool-passprofile/);
});
