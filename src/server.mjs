import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { migrate, query, withTransaction } from './db.mjs';
import {
  generateRecoveryCodes,
  hashPassword,
  normalizeEmail,
  randomToken,
  recoveryHash,
  tokenHash,
  validateEmail,
  validatePassword,
  verifyPassword,
} from './auth-crypto.mjs';
import { loadLocalEnv } from './env.mjs';
import { calculateMachining, OPERATIONS } from './calc-engine.mjs';
import { ISO_GROUPS, MATERIALS } from './materials.mjs';
import { aiStatus, recognizeCncImage } from './ai-recognition.mjs';
import { streamCalculationPdf } from './pdf-report.mjs';

loadLocalEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
const APP_ORIGIN = (process.env.APP_ORIGIN || `http://localhost:${port}`).replace(/\/$/, '');
const RP_ID = process.env.RP_ID || new URL(APP_ORIGIN).hostname;
const RP_NAME = process.env.RP_NAME || 'CNC Calculator';
const secureCookies = production || process.env.SECURE_COOKIES === 'true';
const SESSION_COOKIE = 'cnc_session';
const AUTH_CHALLENGE_COOKIE = 'cnc_auth_challenge';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'",
  );
  if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const attempts = new Map();
function rateLimit(key, limit = 12, windowMs = 60_000) {
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  attempts.set(key, entry);
  return entry.count <= limit;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf('=');
      return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
    }),
  );
}

function cookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (secureCookies || options.secure) parts.push('Secure');
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join('; ');
}

function clearCookie(name) {
  return cookie(name, '', { maxAge: 0, expires: new Date(0) });
}

function jsonError(res, status, message, details) {
  return res.status(status).json({ error: message, ...(details ? { details } : {}) });
}

function verifyOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin || origin === APP_ORIGIN) return next();
  return jsonError(res, 403, 'Недопустимый источник запроса.');
}
app.use('/api', verifyOrigin);

async function createSession(req, res, userId, rememberDevice = false) {
  const previous = parseCookies(req)[SESSION_COOKIE];
  if (previous) await query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(previous)]);
  const raw = randomToken(36);
  const hash = tokenHash(raw);
  const hours = rememberDevice ? 24 * 30 : 12;
  const expires = new Date(Date.now() + hours * 3600_000);
  await query(
    `INSERT INTO sessions(token_hash,user_id,remember_device,user_agent,ip_address,expires_at)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [hash, userId, rememberDevice, req.get('user-agent') || '', req.ip || '', expires],
  );
  res.append('Set-Cookie', cookie(SESSION_COOKIE, raw, { maxAge: hours * 3600 }));
}

async function destroySession(req, res) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (raw) await query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(raw)]);
  res.append('Set-Cookie', clearCookie(SESSION_COOKIE));
}

async function auth(req, res, next) {
  try {
    const raw = parseCookies(req)[SESSION_COOKIE];
    if (!raw) return jsonError(res, 401, 'Требуется авторизация.');
    const result = await query(
      `SELECT s.token_hash,s.user_id,s.expires_at,u.email
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at > NOW()`,
      [tokenHash(raw)],
    );
    const row = result.rows[0];
    if (!row) {
      res.append('Set-Cookie', clearCookie(SESSION_COOKIE));
      return jsonError(res, 401, 'Сессия истекла.');
    }
    req.user = { id: row.user_id, email: row.email };
    req.sessionHash = row.token_hash;
    await query('UPDATE sessions SET last_seen_at=NOW() WHERE token_hash=$1', [row.token_hash]);
    return next();
  } catch (error) {
    return next(error);
  }
}

async function getSettings(userId) {
  await query('INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const { rows } = await query('SELECT * FROM user_settings WHERE user_id=$1', [userId]);
  return rows[0];
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'cnc-calculator' }));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const key = `register:${req.ip}`;
    if (!rateLimit(key, 8, 60_000)) return jsonError(res, 429, 'Слишком много попыток. Повторите позже.');
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const rememberDevice = Boolean(req.body.rememberDevice);
    if (!validateEmail(email)) return jsonError(res, 400, 'Введите корректный email.');
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) return jsonError(res, 400, passwordCheck.message);
    const existing = await query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (existing.rowCount) return jsonError(res, 409, 'Аккаунт с таким email уже существует.');

    const userId = crypto.randomUUID();
    const { salt, hash } = hashPassword(password);
    const recoveryCodes = generateRecoveryCodes(6);
    await withTransaction(async (client) => {
      await client.query('INSERT INTO users(id,email,password_salt,password_hash) VALUES($1,$2,$3,$4)', [userId, email, salt, hash]);
      await client.query('INSERT INTO user_settings(user_id) VALUES($1)', [userId]);
      for (const code of recoveryCodes) {
        await client.query('INSERT INTO recovery_codes(id,user_id,code_hash) VALUES($1,$2,$3)', [crypto.randomUUID(), userId, recoveryHash(code)]);
      }
    });
    await createSession(req, res, userId, rememberDevice);
    return res.status(201).json({ user: { id: userId, email }, recoveryCodes });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const key = `login:${req.ip}:${email}`;
    if (!rateLimit(key, 10, 60_000)) return jsonError(res, 429, 'Слишком много попыток входа.');
    const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
    const user = rows[0];
    if (!user || !verifyPassword(req.body.password || '', user.password_salt, user.password_hash)) {
      return jsonError(res, 401, 'Неверный email или пароль.');
    }
    await createSession(req, res, user.id, Boolean(req.body.rememberDevice));
    return res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', auth, async (req, res, next) => {
  try {
    await destroySession(req, res);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', auth, async (req, res, next) => {
  try {
    const settings = await getSettings(req.user.id);
    const passkeys = await query('SELECT id,label,public_key,created_at,last_used_at FROM passkeys WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    const safePasskeys = passkeys.rows.map(({ public_key, ...row }) => ({
      ...row,
      publicKey: Buffer.from(public_key).toString('base64url'),
    }));
    res.json({ user: req.user, settings, passkeys: safePasskeys });
  } catch (error) { next(error); }
});

app.post('/api/auth/recover', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const newPassword = String(req.body.newPassword || '');
    const check = validatePassword(newPassword);
    if (!check.ok) return jsonError(res, 400, check.message);
    if (!rateLimit(`recover:${req.ip}:${email}`, 8, 5 * 60_000)) return jsonError(res, 429, 'Слишком много попыток восстановления.');
    const users = await query('SELECT id FROM users WHERE email=$1', [email]);
    const user = users.rows[0];
    if (!user) return jsonError(res, 400, 'Код восстановления не найден.');
    const codeHash = recoveryHash(req.body.recoveryCode || '');
    const codes = await query('SELECT id FROM recovery_codes WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL', [user.id, codeHash]);
    const code = codes.rows[0];
    if (!code) return jsonError(res, 400, 'Код восстановления недействителен или уже использован.');
    const { salt, hash } = hashPassword(newPassword);
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET password_salt=$1,password_hash=$2 WHERE id=$3', [salt, hash, user.id]);
      await client.query('UPDATE recovery_codes SET used_at=NOW() WHERE id=$1', [code.id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/auth/sessions', auth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT token_hash,remember_device,user_agent,ip_address,created_at,last_seen_at,expires_at
       FROM sessions WHERE user_id=$1 ORDER BY last_seen_at DESC`,
      [req.user.id],
    );
    res.json({ sessions: rows.map((s) => ({
      id: s.token_hash,
      remember_device: s.remember_device,
      user_agent: s.user_agent,
      ip_address: s.ip_address,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      expires_at: s.expires_at,
      current: s.token_hash === req.sessionHash,
    })) });
  } catch (error) { next(error); }
});

app.delete('/api/auth/sessions/others', auth, async (req, res, next) => {
  try {
    await query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [req.user.id, req.sessionHash]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.delete('/api/auth/sessions/:id', auth, async (req, res, next) => {
  try {
    const result = await query('DELETE FROM sessions WHERE token_hash=$1 AND user_id=$2 RETURNING token_hash', [req.params.id, req.user.id]);
    if (!result.rowCount) return jsonError(res, 404, 'Сессия не найдена.');
    const current = req.params.id === req.sessionHash;
    if (current) res.append('Set-Cookie', clearCookie(SESSION_COOKIE));
    res.json({ ok: true, current });
  } catch (error) { next(error); }
});

app.delete('/api/auth/sessions', auth, async (req, res, next) => {
  try {
    await query('DELETE FROM sessions WHERE user_id=$1', [req.user.id]);
    res.append('Set-Cookie', clearCookie(SESSION_COOKIE));
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/auth/password', auth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const check = validatePassword(newPassword);
    if (!check.ok) return jsonError(res, 400, check.message);
    const users = await query('SELECT password_salt,password_hash FROM users WHERE id=$1', [req.user.id]);
    const user = users.rows[0];
    if (!user || !verifyPassword(currentPassword, user.password_salt, user.password_hash)) return jsonError(res, 401, 'Текущий пароль неверен.');
    const { salt, hash } = hashPassword(newPassword);
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET password_salt=$1,password_hash=$2 WHERE id=$3', [salt, hash, req.user.id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [req.user.id, req.sessionHash]);
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/auth/recovery-codes/regenerate', auth, async (req, res, next) => {
  try {
    const users = await query('SELECT password_salt,password_hash FROM users WHERE id=$1', [req.user.id]);
    const user = users.rows[0];
    if (!user || !verifyPassword(String(req.body.password || ''), user.password_salt, user.password_hash)) return jsonError(res, 401, 'Пароль неверен.');
    const recoveryCodes = generateRecoveryCodes(6);
    await withTransaction(async (client) => {
      await client.query('DELETE FROM recovery_codes WHERE user_id=$1', [req.user.id]);
      for (const code of recoveryCodes) {
        await client.query('INSERT INTO recovery_codes(id,user_id,code_hash) VALUES($1,$2,$3)', [crypto.randomUUID(), req.user.id, recoveryHash(code)]);
      }
    });
    res.json({ recoveryCodes });
  } catch (error) { next(error); }
});

app.post('/api/auth/passkey/register/options', auth, async (req, res, next) => {
  try {
    const passkeys = await query('SELECT id,transports FROM passkeys WHERE user_id=$1', [req.user.id]);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: req.user.email,
      userDisplayName: req.user.email,
      userID: new Uint8Array(Buffer.from(req.user.id, 'utf8')),
      attestationType: 'none',
      excludeCredentials: passkeys.rows.map((p) => ({ id: p.id, transports: p.transports || undefined })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
      supportedAlgorithmIDs: [-7, -257],
    });
    await query('DELETE FROM webauthn_challenges WHERE user_id=$1 AND kind=$2', [req.user.id, 'register']);
    await query(
      'INSERT INTO webauthn_challenges(id,user_id,kind,challenge,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL \'5 minutes\')',
      [crypto.randomUUID(), req.user.id, 'register', options.challenge],
    );
    res.json(options);
  } catch (error) { next(error); }
});

app.post('/api/auth/passkey/register/verify', auth, async (req, res, next) => {
  try {
    const challenges = await query(
      `SELECT * FROM webauthn_challenges WHERE user_id=$1 AND kind='register' AND expires_at>NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id],
    );
    const challenge = challenges.rows[0];
    if (!challenge) return jsonError(res, 400, 'Сессия регистрации Face ID истекла.');
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challenge.challenge,
      expectedOrigin: APP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return jsonError(res, 400, 'Не удалось подтвердить Passkey.');
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await query(
      `INSERT INTO passkeys(id,user_id,public_key,webauthn_user_id,counter,device_type,backed_up,transports,label)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [credential.id, req.user.id, Buffer.from(credential.publicKey), Buffer.from(req.user.id, 'utf8').toString('base64url'), credential.counter, credentialDeviceType, credentialBackedUp, credential.transports || null, req.body.label || 'Face ID / Passkey'],
    );
    await query('DELETE FROM webauthn_challenges WHERE user_id=$1 AND kind=$2', [req.user.id, 'register']);
    res.json({ verified: true });
  } catch (error) {
    console.error('passkey register', error);
    jsonError(res, 400, error.message || 'Ошибка регистрации Passkey.');
  }
});

app.post('/api/auth/passkey/login/options', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!validateEmail(email)) return jsonError(res, 400, 'Сначала укажите email аккаунта.');
    if (!rateLimit(`passkey:${req.ip}:${email}`, 12, 60_000)) return jsonError(res, 429, 'Слишком много попыток.');
    const users = await query('SELECT id,email FROM users WHERE email=$1', [email]);
    const user = users.rows[0];
    if (!user) return jsonError(res, 404, 'Аккаунт не найден.');
    const passkeys = await query('SELECT id,transports FROM passkeys WHERE user_id=$1', [user.id]);
    if (!passkeys.rowCount) return jsonError(res, 404, 'Для этого аккаунта Face ID / Passkey ещё не настроен.');
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: passkeys.rows.map((p) => ({ id: p.id, transports: p.transports || undefined })),
      userVerification: 'required',
    });
    const challengeId = crypto.randomUUID();
    await query('DELETE FROM webauthn_challenges WHERE user_id=$1 AND kind=$2', [user.id, 'login']);
    await query(
      'INSERT INTO webauthn_challenges(id,user_id,email,kind,challenge,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL \'5 minutes\')',
      [challengeId, user.id, email, 'login', options.challenge],
    );
    res.append('Set-Cookie', cookie(AUTH_CHALLENGE_COOKIE, challengeId, { maxAge: 300 }));
    res.json(options);
  } catch (error) { next(error); }
});

app.post('/api/auth/passkey/login/verify', async (req, res, next) => {
  try {
    const challengeId = parseCookies(req)[AUTH_CHALLENGE_COOKIE];
    if (!challengeId) return jsonError(res, 400, 'Сессия входа Face ID истекла.');
    const challenges = await query('SELECT * FROM webauthn_challenges WHERE id=$1 AND kind=$2 AND expires_at>NOW()', [challengeId, 'login']);
    const challenge = challenges.rows[0];
    if (!challenge) return jsonError(res, 400, 'Сессия входа Face ID истекла.');
    const passkeys = await query('SELECT * FROM passkeys WHERE id=$1 AND user_id=$2', [req.body.id, challenge.user_id]);
    const passkey = passkeys.rows[0];
    if (!passkey) return jsonError(res, 400, 'Passkey не найден.');
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challenge.challenge,
      expectedOrigin: APP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: Number(passkey.counter),
        transports: passkey.transports || undefined,
      },
      requireUserVerification: true,
    });
    if (!verification.verified) return jsonError(res, 401, 'Face ID / Passkey не подтверждён.');
    await query('UPDATE passkeys SET counter=$1,last_used_at=NOW() WHERE id=$2', [verification.authenticationInfo.newCounter, passkey.id]);
    await query('DELETE FROM webauthn_challenges WHERE id=$1', [challengeId]);
    res.append('Set-Cookie', clearCookie(AUTH_CHALLENGE_COOKIE));
    await createSession(req, res, challenge.user_id, Boolean(req.body.rememberDevice));
    const users = await query('SELECT id,email FROM users WHERE id=$1', [challenge.user_id]);
    res.json({ verified: true, user: users.rows[0] });
  } catch (error) {
    console.error('passkey login', error);
    jsonError(res, 400, error.message || 'Ошибка входа Passkey.');
  }
});

app.delete('/api/auth/passkeys/:id', auth, async (req, res, next) => {
  try {
    await query('DELETE FROM passkeys WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.patch('/api/auth/passkeys/:id', auth, async (req, res, next) => {
  try {
    const label = String(req.body.label || '').trim().slice(0, 80);
    if (!label) return jsonError(res, 400, 'Введите название Passkey.');
    const result = await query('UPDATE passkeys SET label=$1 WHERE id=$2 AND user_id=$3 RETURNING id,label,created_at,last_used_at', [label, req.params.id, req.user.id]);
    if (!result.rowCount) return jsonError(res, 404, 'Passkey не найден.');
    res.json({ passkey: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/ai/status', auth, (_req, res) => res.json(aiStatus()));

app.post('/api/ai/recognize', auth, async (req, res, next) => {
  try {
    if (!rateLimit(`ai:${req.user.id}`, 12, 60 * 60_000)) return jsonError(res, 429, 'Лимит AI-распознаваний исчерпан. Повторите через час.');
    const result = await recognizeCncImage({
      kind: req.body.kind,
      imageDataUrl: req.body.imageDataUrl,
      note: req.body.note,
    });
    res.json(result);
  } catch (error) {
    if (error.code === 'AI_NOT_CONFIGURED') return jsonError(res, 503, error.message);
    if (/изображен|тип распознавания/i.test(error.message || '')) return jsonError(res, 400, error.message);
    if (error.status === 429) return jsonError(res, 429, 'AI временно перегружен или достигнут лимит проекта. Повторите позже.');
    if (error.status === 401 || error.status === 403) return jsonError(res, 503, 'AI-сервис не настроен на сервере.');
    next(error);
  }
});


app.get('/api/sync', auth, async (req, res, next) => {
  try {
    await query(`INSERT INTO user_sync_state(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING`, [req.user.id]);
    const { rows } = await query('SELECT payload,revision,updated_at FROM user_sync_state WHERE user_id=$1', [req.user.id]);
    res.json(rows[0] || { payload: {}, revision: 0, updated_at: null });
  } catch (error) { next(error); }
});

app.put('/api/sync', auth, async (req, res, next) => {
  try {
    const payload = req.body?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return jsonError(res, 400, 'Некорректный пакет синхронизации.');
    const encoded = JSON.stringify(payload);
    if (Buffer.byteLength(encoded, 'utf8') > 10 * 1024 * 1024) return jsonError(res, 413, 'Пакет синхронизации слишком большой.');
    const result = await query(
      `INSERT INTO user_sync_state(user_id,payload,revision,updated_at)
       VALUES($1,$2::jsonb,1,NOW())
       ON CONFLICT (user_id) DO UPDATE SET payload=EXCLUDED.payload,revision=user_sync_state.revision+1,updated_at=NOW()
       RETURNING revision,updated_at`,
      [req.user.id, encoded],
    );
    res.json({ ok: true, revision: Number(result.rows[0].revision), updatedAt: result.rows[0].updated_at });
  } catch (error) { next(error); }
});

app.post('/api/scan-insert', auth, async (req, res, next) => {
  try {
    if (!rateLimit(`ai:${req.user.id}`, 12, 60 * 60_000)) return jsonError(res, 429, 'Лимит AI-распознаваний исчерпан. Повторите через час.');
    const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, 4) : [];
    if (!images.length) return jsonError(res, 400, 'Добавьте хотя бы одно фото.');
    const result = await recognizeCncImage({ kind: 'tool', imageDataUrls: images, note: images.length > 1 ? `Оператор приложил ${images.length} фото одной и той же позиции. Основное фото — первое.` : '' });
    const r = result.recognition || {};
    const opMap = { facing:'face', turning:'od', boring:'bore', groove_external:'groove', groove_internal:'groove', parting:'part', thread_external:'thread_ext', thread_internal:'thread_int', drilling:'drill', center_drilling:'drill', reaming:'drill' };
    const operations = [...new Set((r.operations || []).map((x) => opMap[x]).filter(Boolean))];
    const evidence = [...(r.evidence || []), r.notes].filter(Boolean).join('\n');
    res.json({
      manufacturer: r.manufacturer || '',
      insert: r.code || '',
      designation: r.code || '',
      grade: r.grade || '',
      breaker: '',
      chipbreaker: '',
      nose_radius_mm: r.noseRadius ?? null,
      nose: r.noseRadius ?? null,
      holder_compatibility: (r.compatibleCodes || []).join(', '),
      iso: r.isoGroups || [],
      material_groups: r.isoGroups || [],
      operations,
      confidence: r.confidence || 0,
      evidence,
      notes: r.notes || '',
      needs_confirmation: true,
    });
  } catch (error) {
    if (error.code === 'AI_NOT_CONFIGURED') return jsonError(res, 503, error.message);
    if (/изображен|тип распознавания/i.test(error.message || '')) return jsonError(res, 400, error.message);
    if (error.status === 429) return jsonError(res, 429, 'AI временно перегружен или достигнут лимит проекта. Повторите позже.');
    if (error.status === 401 || error.status === 403) return jsonError(res, 503, 'AI-сервис не настроен на сервере.');
    next(error);
  }
});

app.get('/api/materials', auth, (_req, res) => {
  res.json({ materials: MATERIALS, isoGroups: ISO_GROUPS });
});

app.get('/api/operations', auth, (_req, res) => {
  res.json({ operations: Object.entries(OPERATIONS).map(([code, value]) => ({ code, ...value })) });
});

app.get('/api/tools', auth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM tools WHERE user_id=$1 ORDER BY favorite DESC,updated_at DESC', [req.user.id]);
    res.json({ tools: rows });
  } catch (error) { next(error); }
});

app.post('/api/tools', auth, async (req, res, next) => {
  try {
    if (!String(req.body.name || '').trim()) return jsonError(res, 400, 'Укажите название инструмента.');
    const id = crypto.randomUUID();
    const values = toolValues(req.body);
    await query(
      `INSERT INTO tools(id,user_id,name,manufacturer,code,grade,tool_type,nose_radius,width_mm,diameter_mm,handedness,shank_size,compatible_codes,operations,iso_groups,vc_min,vc_max,feed_min,feed_max,ap_min,ap_max,notes,favorite)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [id, req.user.id, ...values],
    );
    const row = await query('SELECT * FROM tools WHERE id=$1', [id]);
    res.status(201).json({ tool: row.rows[0] });
  } catch (error) { next(error); }
});

app.put('/api/tools/:id', auth, async (req, res, next) => {
  try {
    const values = toolValues(req.body);
    const result = await query(
      `UPDATE tools SET name=$1,manufacturer=$2,code=$3,grade=$4,tool_type=$5,nose_radius=$6,width_mm=$7,diameter_mm=$8,
       handedness=$9,shank_size=$10,compatible_codes=$11,operations=$12,iso_groups=$13,vc_min=$14,vc_max=$15,feed_min=$16,feed_max=$17,ap_min=$18,ap_max=$19,notes=$20,favorite=$21,updated_at=NOW()
       WHERE id=$22 AND user_id=$23 RETURNING *`,
      [...values, req.params.id, req.user.id],
    );
    if (!result.rowCount) return jsonError(res, 404, 'Инструмент не найден.');
    res.json({ tool: result.rows[0] });
  } catch (error) { next(error); }
});

app.delete('/api/tools/:id', auth, async (req, res, next) => {
  try {
    await query('DELETE FROM tools WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

function toolValues(body) {
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const legacyType = String(body.tool_type || 'insert');
  const toolType = legacyType === 'carbide_insert' ? 'insert' : ['insert', 'holder', 'drill', 'mill', 'tap', 'other'].includes(legacyType) ? legacyType : 'other';
  return [
    String(body.name || '').trim(), String(body.manufacturer || '').trim() || null,
    String(body.code || '').trim() || null, String(body.grade || '').trim() || null,
    toolType, num(body.nose_radius), num(body.width_mm), num(body.diameter_mm),
    String(body.handedness || '').trim() || null, String(body.shank_size || '').trim() || null,
    JSON.stringify(Array.isArray(body.compatible_codes) ? body.compatible_codes : []),
    JSON.stringify(Array.isArray(body.operations) ? body.operations : []), JSON.stringify(Array.isArray(body.iso_groups) ? body.iso_groups : []),
    num(body.vc_min), num(body.vc_max), num(body.feed_min), num(body.feed_max), num(body.ap_min), num(body.ap_max),
    String(body.notes || '').trim() || null, Boolean(body.favorite),
  ];
}

app.post('/api/calculate', auth, async (req, res, next) => {
  try {
    const settings = await getSettings(req.user.id);
    let tool = null;
    if (req.body.toolId) {
      const result = await query('SELECT * FROM tools WHERE id=$1 AND user_id=$2', [req.body.toolId, req.user.id]);
      tool = result.rows[0] || null;
    }
    const inputs = {
      ...req.body,
      maxRpm: req.body.maxRpm || settings.max_rpm,
      machinePowerKw: settings.machine_power_kw,
      tool,
    };
    const results = calculateMachining(inputs);
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO calculations(id,user_id,material_code,operation,tool_id,mode,diameter_mm,inputs,results)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, req.user.id, req.body.materialCode, req.body.operation, tool?.id || null, req.body.mode || 'normal', Number(req.body.diameterMm), JSON.stringify({ ...req.body, tool: undefined }), JSON.stringify(results)],
    );
    res.json({ calculation: { id, inputs: { ...req.body }, results, favorite: false, created_at: new Date().toISOString() } });
  } catch (error) {
    if (/Материал|Операция|диаметр|резьбы/.test(error.message || '')) return jsonError(res, 400, error.message);
    next(error);
  }
});

app.get('/api/calculations', auth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,t.name AS tool_name,t.code AS tool_code
       FROM calculations c LEFT JOIN tools t ON t.id=c.tool_id
       WHERE c.user_id=$1 ORDER BY c.created_at DESC LIMIT 200`,
      [req.user.id],
    );
    res.json({ calculations: rows });
  } catch (error) { next(error); }
});

app.get('/api/calculations/:id', auth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,t.name AS tool_name,t.code AS tool_code,t.manufacturer AS tool_manufacturer
       FROM calculations c LEFT JOIN tools t ON t.id=c.tool_id
       WHERE c.id=$1 AND c.user_id=$2`,
      [req.params.id, req.user.id],
    );
    if (!rows[0]) return jsonError(res, 404, 'Расчёт не найден.');
    res.json({ calculation: rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/calculations/:id/pdf', auth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,t.name AS tool_name,t.code AS tool_code,t.manufacturer AS tool_manufacturer
       FROM calculations c LEFT JOIN tools t ON t.id=c.tool_id
       WHERE c.id=$1 AND c.user_id=$2`,
      [req.params.id, req.user.id],
    );
    if (!rows[0]) return jsonError(res, 404, 'Расчёт не найден.');
    streamCalculationPdf(res, rows[0]);
  } catch (error) { next(error); }
});

app.patch('/api/calculations/:id/favorite', auth, async (req, res, next) => {
  try {
    const result = await query('UPDATE calculations SET favorite=$1 WHERE id=$2 AND user_id=$3 RETURNING favorite', [Boolean(req.body.favorite), req.params.id, req.user.id]);
    if (!result.rowCount) return jsonError(res, 404, 'Расчёт не найден.');
    res.json({ favorite: result.rows[0].favorite });
  } catch (error) { next(error); }
});

app.delete('/api/calculations/:id', auth, async (req, res, next) => {
  try {
    await query('DELETE FROM calculations WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.put('/api/settings', auth, async (req, res, next) => {
  try {
    const theme = ['system', 'light', 'dark'].includes(req.body.theme) ? req.body.theme : 'system';
    const maxRpm = Math.min(100000, Math.max(100, Number(req.body.maxRpm || 4000)));
    const autoLock = Math.min(240, Math.max(1, Number(req.body.autoLockMinutes || 15)));
    const machineName = String(req.body.machineName || 'CK52PT-Y · SINUMERIK 828D').slice(0, 100);
    const machinePowerKw = Math.min(500, Math.max(0.5, Number(req.body.machinePowerKw || 11)));
    const result = await query(
      `INSERT INTO user_settings(user_id,theme,max_rpm,auto_lock_minutes,machine_name,machine_power_kw,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (user_id) DO UPDATE SET theme=EXCLUDED.theme,max_rpm=EXCLUDED.max_rpm,auto_lock_minutes=EXCLUDED.auto_lock_minutes,machine_name=EXCLUDED.machine_name,machine_power_kw=EXCLUDED.machine_power_kw,updated_at=NOW()
       RETURNING *`,
      [req.user.id, theme, maxRpm, autoLock, machineName, machinePowerKw],
    );
    res.json({ settings: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/export', auth, async (req, res, next) => {
  try {
    const [tools, calculations, settings] = await Promise.all([
      query('SELECT * FROM tools WHERE user_id=$1 ORDER BY created_at', [req.user.id]),
      query('SELECT * FROM calculations WHERE user_id=$1 ORDER BY created_at', [req.user.id]),
      getSettings(req.user.id),
    ]);
    res.setHeader('Content-Disposition', `attachment; filename="cnc-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ version: 1, exportedAt: new Date().toISOString(), tools: tools.rows, calculations: calculations.rows, settings });
  } catch (error) { next(error); }
});

app.use('/api', (_req, res) => jsonError(res, 404, 'API route not found'));

app.use(express.static(path.resolve(__dirname, '../public'), {
  etag: true,
  maxAge: production ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('service-worker.js') || filePath.endsWith('manifest.webmanifest') || filePath.endsWith('index.html') || filePath.endsWith('styles.css') || filePath.endsWith('app.js') || filePath.endsWith('cloud.js') || filePath.endsWith('data.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

app.use((_req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (String(error?.code) === '23505') return jsonError(res, 409, 'Такая запись уже существует.');
  return jsonError(res, 500, production ? 'Внутренняя ошибка сервера.' : error.message || 'Server error');
});

await migrate();
app.listen(port, '0.0.0.0', () => {
  console.log(`CNC Calculator listening on http://0.0.0.0:${port}`);
  console.log(`WebAuthn RP ID: ${RP_ID}`);
  console.log(`Expected origin: ${APP_ORIGIN}`);
});
