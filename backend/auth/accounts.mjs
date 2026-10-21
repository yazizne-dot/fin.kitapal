import { createHash } from 'node:crypto';
import { withTransaction } from '../db/connection.mjs';
import { hashPassword, verifyPassword, validateNewPassword, passwordChangeDue } from './passwords.mjs';
import { hashToken, issueSession } from './sessions.mjs';

const GENERIC_LOGIN_ERROR = 'Invalid username or password';
const DUMMY_SALT = '00000000000000000000000000000000';
const DUMMY_HASH = '0'.repeat(128);

export class AuthenticationError extends Error {
  constructor(message = GENERIC_LOGIN_ERROR) { super(message); this.status = 401; }
}

function publicUser(user, now = new Date()) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    organization_id: user.organization_id ?? null,
    location_id: user.location_id ?? null,
    language: user.language ?? 'kk',
    active: Boolean(user.active),
    org: user.org ?? '',
    point: user.point ?? '',
    must_change_password: passwordChangeDue(user, now),
  };
}

export async function login({ pool, username, password, remember = false, now = new Date() }) {
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 1024) throw new AuthenticationError();
  const normalized = username.trim().toLowerCase();
  const subjectHash = createHash('sha256').update(normalized).digest();
  const outcome = await withTransaction(pool, async client => {
    await client.query(`INSERT INTO qarzhy.login_attempts(subject_hash,failed_count,updated_at)
      VALUES($1,0,$2) ON CONFLICT(subject_hash) DO NOTHING`, [subjectHash, now]);
    const attempt = (await client.query(`SELECT failed_count,blocked_until FROM qarzhy.login_attempts
      WHERE subject_hash=$1 FOR UPDATE`, [subjectHash])).rows[0];
    if (attempt?.blocked_until && new Date(attempt.blocked_until).getTime() > new Date(now).getTime()) return null;
    const user = (await client.query(`SELECT u.*,r.code AS role,o.name AS org,l.name AS point FROM qarzhy.users u
      JOIN qarzhy.roles r ON r.id=u.role_id
      LEFT JOIN qarzhy.organizations o ON o.id=u.organization_id
      LEFT JOIN qarzhy.locations l ON l.id=u.location_id
      WHERE u.username=$1 FOR UPDATE OF u`, [normalized])).rows[0];
    const valid = await verifyPassword(password, user || { password_salt: DUMMY_SALT, password_hash: DUMMY_HASH });
    if (!user?.active || !valid) {
      const count = (attempt?.failed_count || 0) + 1;
      await client.query(`UPDATE qarzhy.login_attempts SET failed_count=$2,
        blocked_until=CASE WHEN $2>=5 THEN $3::timestamptz ELSE NULL END,updated_at=$4 WHERE subject_hash=$1`,
        [subjectHash, count, new Date(new Date(now).getTime() + 15 * 60_000), now]);
      return null;
    }
    await client.query('DELETE FROM qarzhy.login_attempts WHERE subject_hash=$1', [subjectHash]);
    const session = await issueSession(client, { userId: user.id, remember, now });
    await client.query(`INSERT INTO qarzhy.audit_log(actor_id,actor_name,action,occurred_at,entity_type,entity_id)
      VALUES($1,$2,'login',$3,'user',$1)`, [user.id, user.name, now]);
    return { ...session, user: publicUser(user, now) };
  });
  if (!outcome) throw new AuthenticationError();
  return outcome;
}

export async function changePassword({ pool, principal, currentPassword, newPassword, now = new Date() }) {
  if (!principal?.id || !principal?.token) throw new AuthenticationError('Session expired');
  validateNewPassword(newPassword);
  const subjectHash = createHash('sha256').update(`password-change:${principal.id}`).digest();
  const outcome = await withTransaction(pool, async client => {
    await client.query(`INSERT INTO qarzhy.login_attempts(subject_hash,failed_count,updated_at)
      VALUES($1,0,$2) ON CONFLICT(subject_hash) DO NOTHING`, [subjectHash, now]);
    const attempt = (await client.query(`SELECT failed_count,blocked_until FROM qarzhy.login_attempts
      WHERE subject_hash=$1 FOR UPDATE`, [subjectHash])).rows[0];
    if (attempt?.blocked_until && new Date(attempt.blocked_until).getTime() > new Date(now).getTime()) return { error: 'Too many password attempts' };
    const row = (await client.query(`SELECT u.*,r.code AS role,o.name AS org,l.name AS point FROM qarzhy.users u
      JOIN qarzhy.sessions s ON s.user_id=u.id
      JOIN qarzhy.roles r ON r.id=u.role_id
      LEFT JOIN qarzhy.organizations o ON o.id=u.organization_id
      LEFT JOIN qarzhy.locations l ON l.id=u.location_id
      WHERE u.id=$1 AND u.active=true AND s.token_hash=$2 AND s.expires_at>$3
      FOR UPDATE OF u,s`, [principal.id, hashToken(principal.token), now])).rows[0];
    if (!row) return { error: 'Session expired' };
    if (!await verifyPassword(currentPassword, row)) {
      const count = (attempt?.failed_count || 0) + 1;
      await client.query(`UPDATE qarzhy.login_attempts SET failed_count=$2,
        blocked_until=CASE WHEN $2>=5 THEN $3::timestamptz ELSE NULL END,updated_at=$4 WHERE subject_hash=$1`,
        [subjectHash, count, new Date(new Date(now).getTime() + 15 * 60_000), now]);
      return { error: 'Current password is incorrect' };
    }
    if (await verifyPassword(newPassword, row)) throw new Error('New password must differ from current password');
    const hashed = await hashPassword(newPassword);
    await client.query(`UPDATE qarzhy.users SET password_salt=$2,password_hash=$3,
      password_changed_at=$4,must_change_password=false,updated_at=$4,version=version+1 WHERE id=$1`,
      [row.id, hashed.password_salt, hashed.password_hash, now]);
    await client.query('DELETE FROM qarzhy.sessions WHERE user_id=$1', [row.id]);
    await client.query('DELETE FROM qarzhy.login_attempts WHERE subject_hash=$1', [subjectHash]);
    const session = await issueSession(client, { userId: row.id, remember: false, now });
    await client.query(`INSERT INTO qarzhy.audit_log(actor_id,actor_name,action,occurred_at,entity_type,entity_id)
      VALUES($1,$2,'password_change',$3,'user',$1)`, [row.id, row.name, now]);
    return { ...session, user: publicUser({ ...row, must_change_password: false, password_changed_at: now }, now) };
  });
  if (outcome.error) throw new AuthenticationError(outcome.error);
  return outcome;
}

export async function resetPassword({ pool, actor, userId, temporaryPassword, now = new Date() }) {
  validateNewPassword(temporaryPassword);
  return withTransaction(pool, async client => {
    const target = (await client.query('SELECT id,name FROM qarzhy.users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
    if (!target) throw new Error('User not found');
    const hashed = await hashPassword(temporaryPassword);
    await client.query(`UPDATE qarzhy.users SET password_salt=$2,password_hash=$3,password_changed_at=NULL,
      must_change_password=true,updated_at=$4,version=version+1 WHERE id=$1`,
      [userId, hashed.password_salt, hashed.password_hash, now]);
    await client.query('DELETE FROM qarzhy.sessions WHERE user_id=$1', [userId]);
    await client.query(`INSERT INTO qarzhy.audit_log(actor_id,actor_name,action,occurred_at,entity_type,entity_id)
      VALUES($1,$2,'password_reset',$3,'user',$4)`, [actor.id, actor.name, now, userId]);
  });
}
