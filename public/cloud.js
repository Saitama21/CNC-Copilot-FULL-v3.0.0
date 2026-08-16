(() => {
'use strict';
const $ = s => document.querySelector(s);
const PROFILE_KEY = 'cncV3TrustedProfile';
let connected = false;
let user = null;
let passkeys = [];
let syncing = false;
let syncTimer = null;
const authGate = $('#v3AuthGate');

function msg(text, type = 'error') {
  const el = $('#v3AuthMessage');
  el.textContent = text;
  el.className = `v3-auth-message ${type}`;
}
function clearMsg() { $('#v3AuthMessage').className = 'v3-auth-message hidden'; }
function b64buf(value) {
  const pad = '='.repeat((4 - value.length % 4) % 4);
  const text = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}
function buf64(buffer) {
  let text = '';
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function equalBytes(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}
function concatBytes(...parts) {
  const arrays = parts.map(part => new Uint8Array(part));
  const out = new Uint8Array(arrays.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of arrays) { out.set(part, offset); offset += part.length; }
  return out.buffer;
}
function requestOptions(json) {
  return {
    ...json,
    challenge: b64buf(json.challenge),
    allowCredentials: (json.allowCredentials || []).map(c => ({ ...c, id: b64buf(c.id) })),
  };
}
function authJSON(credential) {
  return {
    id: credential.id,
    rawId: buf64(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: buf64(credential.response.clientDataJSON),
      authenticatorData: buf64(credential.response.authenticatorData),
      signature: buf64(credential.response.signature),
      userHandle: credential.response.userHandle ? buf64(credential.response.userHandle) : null,
    },
  };
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || data || `HTTP ${response.status}`);
  return data;
}
function profile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { return null; }
}
function saveProfile(me) {
  const p = {
    email: me.user?.email || '',
    passkeys: (me.passkeys || []).filter(x => x.id && x.publicKey).map(x => ({
      id: x.id,
      label: x.label || 'Passkey',
      publicKey: x.publicKey,
    })),
    savedAt: Date.now(),
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  return p;
}

/* Minimal CBOR reader for COSE public keys (EC2 P-256 and RSA). */
function decodeCbor(input) {
  const bytes = new Uint8Array(input);
  let offset = 0;
  function length(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return bytes[offset++];
    if (ai === 25) { const v = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2; return v; }
    if (ai === 26) { const v = bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]; offset += 4; return v; }
    throw new Error('Неподдерживаемый COSE/CBOR ключ.');
  }
  function read() {
    const head = bytes[offset++];
    const major = head >> 5, ai = head & 31;
    const n = length(ai);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2) { const out = bytes.slice(offset, offset + n); offset += n; return out; }
    if (major === 3) { const out = new TextDecoder().decode(bytes.slice(offset, offset + n)); offset += n; return out; }
    if (major === 4) return Array.from({ length: n }, () => read());
    if (major === 5) { const map = new Map(); for (let i = 0; i < n; i += 1) map.set(read(), read()); return map; }
    throw new Error('Неподдерживаемый тип CBOR.');
  }
  return read();
}
function coseKey(publicKeyB64) {
  const map = decodeCbor(b64buf(publicKeyB64));
  const kty = map.get(1), alg = map.get(3);
  if (kty === 2 && alg === -7) {
    return {
      type: 'ES256',
      jwk: { kty: 'EC', crv: 'P-256', x: buf64(map.get(-2)), y: buf64(map.get(-3)), ext: true },
    };
  }
  if (kty === 3 && alg === -257) {
    return {
      type: 'RS256',
      jwk: { kty: 'RSA', n: buf64(map.get(-1)), e: buf64(map.get(-2)), alg: 'RS256', ext: true },
    };
  }
  throw new Error('Этот тип Passkey пока нельзя проверить офлайн.');
}
function derEcdsaToRaw(signature, size = 32) {
  const bytes = new Uint8Array(signature);
  let o = 0;
  if (bytes[o++] !== 0x30) throw new Error('Некорректная ECDSA-подпись.');
  let seqLen = bytes[o++];
  if (seqLen & 0x80) { const c = seqLen & 0x7f; seqLen = 0; for (let i = 0; i < c; i += 1) seqLen = (seqLen << 8) | bytes[o++]; }
  if (bytes[o++] !== 0x02) throw new Error('Некорректная ECDSA-подпись.');
  const rLen = bytes[o++]; let r = bytes.slice(o, o + rLen); o += rLen;
  if (bytes[o++] !== 0x02) throw new Error('Некорректная ECDSA-подпись.');
  const sLen = bytes[o++]; let s = bytes.slice(o, o + sLen);
  while (r.length > size && r[0] === 0) r = r.slice(1);
  while (s.length > size && s[0] === 0) s = s.slice(1);
  const out = new Uint8Array(size * 2);
  out.set(r, size - r.length);
  out.set(s, size * 2 - s.length);
  return out.buffer;
}
async function verifyOfflineAssertion(credential, challenge, savedPasskey) {
  const clientBytes = credential.response.clientDataJSON;
  const client = JSON.parse(new TextDecoder().decode(clientBytes));
  if (client.type !== 'webauthn.get') throw new Error('Некорректный тип WebAuthn-ответа.');
  if (client.challenge !== buf64(challenge)) throw new Error('Challenge Passkey не совпал.');
  if (client.origin !== location.origin) throw new Error('Origin Passkey не совпал.');

  const authData = credential.response.authenticatorData;
  const authBytes = new Uint8Array(authData);
  if (authBytes.length < 37) throw new Error('Некорректные данные аутентификатора.');
  const expectedRp = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.hostname));
  if (!equalBytes(authBytes.slice(0, 32), expectedRp)) throw new Error('RP ID Passkey не совпал.');
  const flags = authBytes[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw new Error('Passkey не подтвердил пользователя.');

  const clientHash = await crypto.subtle.digest('SHA-256', clientBytes);
  const signed = concatBytes(authData, clientHash);
  const parsed = coseKey(savedPasskey.publicKey);
  if (parsed.type === 'ES256') {
    const key = await crypto.subtle.importKey('jwk', parsed.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const raw = derEcdsaToRaw(credential.response.signature);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, signed);
  }
  const key = await crypto.subtle.importKey('jwk', parsed.jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, credential.response.signature, signed);
}

function setMode(on) {
  connected = !!on;
  document.documentElement.dataset.onlineMode = connected ? 'online' : 'local';
  const dot = $('#v3OnlineDot'), text = $('#v3OnlineText');
  if (dot) dot.classList.toggle('on', connected);
  if (text) text.textContent = connected ? 'ОНЛАЙН' : 'ЛОКАЛЬНО';
  const label = $('#offlineLabel');
  if (label) label.textContent = connected ? 'ОНЛАЙН-ФУНКЦИИ · АКТИВНЫ' : 'ЛОКАЛЬНОЕ ЯДРО · ГОТОВО';
  document.querySelector('.top-status .status-dot')?.classList.toggle('is-online', connected);
  renderCloudPanel();
}
function openApp() { authGate.classList.add('hidden'); setMode(false); }
function setAuthMode(mode) {
  document.querySelectorAll('[data-v3-mode]').forEach(b => b.classList.toggle('active', b.dataset.v3Mode === mode));
  $('#v3LocalPane').classList.toggle('hidden', mode !== 'local');
  $('#v3OnlineForm').classList.toggle('hidden', mode !== 'online');
  clearMsg();
}
async function localUnlock() {
  const p = profile();
  if (!p?.passkeys?.length) return msg('Сначала один раз войди онлайн и добавь Face ID / Passkey.');
  if (!window.PublicKeyCredential) return msg('Этот браузер не поддерживает Passkey.');
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.get({ publicKey: {
      challenge,
      rpId: location.hostname,
      allowCredentials: p.passkeys.map(x => ({ type: 'public-key', id: b64buf(x.id) })),
      userVerification: 'required',
      timeout: 60000,
    }});
    const saved = p.passkeys.find(x => x.id === credential?.id);
    if (!saved) throw new Error('Passkey не совпал с доверенным профилем.');
    const verified = await verifyOfflineAssertion(credential, challenge, saved);
    if (!verified) throw new Error('Не удалось проверить подпись Passkey офлайн.');
    openApp();
  } catch (error) {
    if (error.name !== 'NotAllowedError') msg(error.message);
  }
}
async function hydrateMe() {
  const me = await api('/api/auth/me');
  user = me.user;
  passkeys = me.passkeys || [];
  saveProfile(me);
  return me;
}
async function onlineLogin(email, password) {
  await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password, rememberDevice: $('#v3Remember').checked }) });
  await hydrateMe();
  openApp();
  await connectOnline();
}
async function passkeyLogin() {
  const email = $('#v3Email').value.trim() || profile()?.email || '';
  if (!email) return msg('Введите электронную почту.');
  try {
    const options = await api('/api/auth/passkey/login/options', { method: 'POST', body: JSON.stringify({ email }) });
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
    const body = authJSON(credential);
    body.rememberDevice = $('#v3Remember').checked;
    await api('/api/auth/passkey/login/verify', { method: 'POST', body: JSON.stringify(body) });
    await hydrateMe();
    openApp();
    await connectOnline();
  } catch (error) {
    if (error.name !== 'NotAllowedError') msg(error.message);
  }
}
async function register() {
  const email = $('#v3Email').value.trim(), password = $('#v3Password').value;
  if (!email || !password) return msg('Введите электронную почту и пароль.');
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, rememberDevice: true }) });
    await hydrateMe();
    msg(`Аккаунт создан. Сохрани коды восстановления: ${data.recoveryCodes?.join(' · ') || 'открой настройки безопасности'}`, 'ok');
    openApp();
    await connectOnline();
  } catch (error) { msg(error.message); }
}
async function connectOnline() {
  if (connected) return;
  if (!navigator.onLine) throw new Error('Сети сейчас нет. Локальное ядро продолжает работать.');
  try { if (!user) await hydrateMe(); } catch { showAuthForOnline(); return; }
  setMode(true);
  await syncNow(true);
  if (!passkeys.length) window.CNC_APP?.toast?.('Для офлайн-входа добавь Face ID / Passkey в меню подключения.');
}
function disconnect() { setMode(false); user = null; clearTimeout(syncTimer); }
function showAuthForOnline() {
  authGate.classList.remove('hidden');
  setAuthMode('online');
  const p = profile();
  if (p?.email) $('#v3Email').value = p.email;
}

function getLocal() { return window.CNC_APP?.getSyncPayload?.() || {}; }
function keyForTool(tool) {
  return tool.canonicalKey || [tool.insert, tool.grade, tool.breaker, tool.nose].map(x => String(x || '').toUpperCase().replace(/\W/g, '')).join('|') || tool.id;
}
function merge(local, remote) {
  const out = { ...remote, ...local };
  const tools = new Map();
  for (const tool of [...(remote.tools || []), ...(local.tools || [])]) tools.set(keyForTool(tool), tool);
  out.tools = [...tools.values()];
  const projects = new Map();
  for (const project of [...(remote.projects || []), ...(local.projects || [])]) projects.set(project.id || project.name, project);
  out.projects = [...projects.values()];
  out.machine = local.machine || remote.machine;
  out.draft = local.draft || remote.draft;
  return out;
}
async function syncNow(silent = false) {
  if (!connected || syncing) return;
  syncing = true;
  try {
    const remote = await api('/api/sync');
    const merged = merge(getLocal(), remote.payload || {});
    window.CNC_APP?.applySyncPayload?.(merged);
    const saved = await api('/api/sync', { method: 'PUT', body: JSON.stringify({ payload: merged, baseRevision: remote.revision || 0 }) });
    if (!silent) window.CNC_APP?.toast?.(`Синхронизация готова · версия ${saved.revision}`);
    renderCloudPanel();
  } catch (error) {
    if (!silent) window.CNC_APP?.toast?.(`Синхронизация: ${error.message}`);
  } finally { syncing = false; }
}
function scheduleSync() {
  if (!connected) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(true), 900);
}
function renderCloudPanel() {
  const body = $('#v3CloudBody');
  if (!body) return;
  const p = profile();
  body.innerHTML = connected
    ? `<div class="v3-cloud-status online"><span></span><div><b>Онлайн-функции включены</b><small>${user?.email || p?.email || ''}</small></div></div><button id="v3SyncNow" class="primary v3-wide">Синхронизировать сейчас</button><button id="v3AddPasskey" class="soft-btn v3-wide">◎ Добавить Face ID / Passkey</button><button id="v3Disconnect" class="ghost v3-wide">Вернуться в локальный режим</button><p class="v3-hint">ИИ и синхронизация обращаются к Railway только пока этот режим включён.</p>`
    : `<div class="v3-cloud-status"><span></span><div><b>Локальный режим</b><small>Сетевых запросов к серверу нет</small></div></div><button id="v3Connect" class="primary v3-wide">Подключить онлайн-функции</button><p class="v3-hint">Расчёты, проекты, шкаф, справочники и экспорт остаются локальными.</p>`;
  $('#v3Connect')?.addEventListener('click', () => connectOnline().catch(e => window.CNC_APP?.toast?.(e.message)));
  $('#v3Disconnect')?.addEventListener('click', disconnect);
  $('#v3SyncNow')?.addEventListener('click', () => syncNow(false));
  $('#v3AddPasskey')?.addEventListener('click', registerPasskey);
}
async function registerPasskey() {
  try {
    const options = await api('/api/auth/passkey/register/options', { method: 'POST', body: '{}' });
    const publicKey = {
      ...options,
      challenge: b64buf(options.challenge),
      user: { ...options.user, id: b64buf(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map(c => ({ ...c, id: b64buf(c.id) })),
    };
    const credential = await navigator.credentials.create({ publicKey });
    const body = {
      id: credential.id,
      rawId: buf64(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: buf64(credential.response.clientDataJSON),
        attestationObject: buf64(credential.response.attestationObject),
        transports: credential.response.getTransports ? credential.response.getTransports() : [],
      },
    };
    await api('/api/auth/passkey/register/verify', { method: 'POST', body: JSON.stringify(body) });
    await hydrateMe();
    window.CNC_APP?.toast?.('Face ID / Passkey добавлен и сохранён для офлайн-входа.');
  } catch (error) {
    if (error.name !== 'NotAllowedError') window.CNC_APP?.toast?.(error.message);
  }
}
function cycleAuthTheme() {
  const modes = ['system', 'light', 'dark'];
  const current = document.documentElement.dataset.themeMode || 'system';
  const next = modes[(modes.indexOf(current) + 1) % modes.length];
  const effective = next === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : next;
  document.documentElement.dataset.themeMode = next;
  document.documentElement.dataset.theme = effective;
  try { localStorage.setItem('cncThemeMode', next); } catch {}
}

document.querySelectorAll('[data-v3-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.v3Mode)));
$('#v3AuthTheme')?.addEventListener('click', cycleAuthTheme);
$('#v3LocalUnlock').addEventListener('click', localUnlock);
$('#v3OnlineForm').addEventListener('submit', event => { event.preventDefault(); onlineLogin($('#v3Email').value, $('#v3Password').value).catch(error => msg(error.message)); });
$('#v3PasskeyLogin').addEventListener('click', passkeyLogin);
$('#v3Register').addEventListener('click', register);
$('#v3OnlineToggle')?.addEventListener('click', () => { $('#v3CloudPanel').classList.remove('hidden'); $('#v3CloudPanel').setAttribute('aria-hidden', 'false'); renderCloudPanel(); });
$('#v3CloudClose')?.addEventListener('click', () => { $('#v3CloudPanel').classList.add('hidden'); $('#v3CloudPanel').setAttribute('aria-hidden', 'true'); });
$('#v3CloudPanel')?.addEventListener('click', event => { if (event.target.id === 'v3CloudPanel') $('#v3CloudClose').click(); });
$('#runScanner')?.addEventListener('click', event => {
  if (!connected) {
    event.preventDefault();
    event.stopImmediatePropagation();
    window.CNC_APP?.toast?.('ИИ выключен. Нажми «ЛОКАЛЬНО» сверху и подключи онлайн-функции.');
  }
}, true);
window.addEventListener('cnc-local-data-changed', event => {
  if (['cncFullMachineV1', 'cncFullToolsV2', 'cncFullProjectsV1'].includes(event.detail?.key)) scheduleSync();
});
window.addEventListener('online', () => { if (connected) renderCloudPanel(); });
window.addEventListener('offline', () => {
  if (connected) {
    setMode(false);
    user = null;
    window.CNC_APP?.toast?.('Сеть пропала · продолжаю локально');
  }
});

const saved = profile();
if (saved?.email) {
  $('#v3Email').value = saved.email;
  $('#v3LocalHint').textContent = saved.passkeys?.length
    ? `Доверенное устройство: ${saved.email}`
    : `${saved.email} · добавь Passkey при следующем онлайн-входе`;
} else {
  $('#v3LocalHint').textContent = 'На новом устройстве сначала нужна онлайн-привязка аккаунта и Passkey.';
}
setMode(false);
})();
