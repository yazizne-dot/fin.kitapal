import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const DAY_MS = 24 * 60 * 60 * 1000;
const COMMON = new Set(['password', '12345678', 'qwerty12', 'admin123',
  'passwordpassword', 'password123456', '123456789012345', 'qwerty123456789',
  'adminadminadmin', 'letmeinletmein', 'changemechangeme']);

export async function verifyPassword(password, user) {
  if (typeof password !== 'string' || !/^[0-9a-f]{32}$/.test(user?.password_salt ?? '') || !/^[0-9a-f]{128}$/.test(user?.password_hash ?? '')) return false;
  const actual = await scrypt(password, user.password_salt, 64);
  return timingSafeEqual(actual, Buffer.from(user.password_hash, 'hex'));
}

export async function hashPassword(password) {
  validateNewPassword(password);
  const password_salt = randomBytes(16).toString('hex');
  const password_hash = (await scrypt(password, password_salt, 64)).toString('hex');
  return { password_salt, password_hash };
}

export function validateNewPassword(password) {
  if (typeof password !== 'string' || [...password].length < 8) throw new Error('Password must have at least 8 characters');
  if ([...password].length > 1024) throw new Error('Password is too long');
  const normalized = password.normalize('NFKC').trim().toLowerCase().replace(/\s/g, '');
  if (COMMON.has(normalized) || /^(.)\1{7,}$/.test(normalized)) throw new Error('Common or weak password');
}

export function passwordChangeDue(user, now = new Date()) {
  if (user.must_change_password) return true;
  if (!user.password_changed_at) return true;
  const changed = new Date(user.password_changed_at).getTime();
  return !Number.isFinite(changed) || changed + 30 * DAY_MS <= new Date(now).getTime();
}
