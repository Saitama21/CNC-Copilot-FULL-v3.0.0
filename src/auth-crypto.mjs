import crypto from 'node:crypto';

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 10) return { ok: false, message: 'Пароль должен содержать минимум 10 символов.' };
  if (!/[A-Za-zА-Яа-яЁё]/.test(value) || !/\d/.test(value)) {
    return { ok: false, message: 'Добавьте в пароль буквы и цифры.' };
  }
  return { ok: true };
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function generateRecoveryCodes(count = 6) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

export function recoveryHash(code) {
  return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}
