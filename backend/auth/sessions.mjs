import { createHash, randomBytes } from 'node:crypto';
import { passwordChangeDue } from './passwords.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

export async function issueSession(client, { userId, remember = false, now = new Date() }) {
  const token = randomBytes(32).toString('hex');
  const createdAt = new Date(now);
  const expiresAt = new Date(createdAt.getTime() + (remember ? 30 : 1) * DAY_MS);
  await client.query(
    'INSERT INTO qarzhy.sessions(user_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4)',
    [userId, hashToken(token), createdAt, expiresAt],
  );
  return { token, expiresAt };
}

export async function resolveSession({ pool, token, now = new Date() }) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const result = await pool.query(`
    SELECT u.id,u.username,u.name,u.role_id,u.organization_id,u.location_id,u.language,u.active,
           u.must_change_password,u.password_changed_at,r.code AS role,s.expires_at,
           o.name AS org,l.name AS point
      FROM qarzhy.sessions s
      JOIN qarzhy.users u ON u.id=s.user_id
      JOIN qarzhy.roles r ON r.id=u.role_id
      LEFT JOIN qarzhy.organizations o ON o.id=u.organization_id
      LEFT JOIN qarzhy.locations l ON l.id=u.location_id
     WHERE s.token_hash=$1
  `, [hashToken(token)]);
  const row = result.rows[0];
  if (!row?.active || new Date(row.expires_at).getTime() <= new Date(now).getTime()) return null;
  const permissions = await pool.query(`
    SELECT p.code FROM qarzhy.permissions p
      LEFT JOIN qarzhy.role_permissions rp ON rp.permission_id=p.id AND rp.role_id=$1
      LEFT JOIN qarzhy.user_permissions up ON up.permission_id=p.id AND up.user_id=$2
     WHERE COALESCE(up.allowed,rp.id IS NOT NULL)
     ORDER BY p.code
  `, [row.role_id, row.id]);
  return { ...row, permissions: permissions.rows.map(item => item.code), password_change_due: passwordChangeDue(row, now) };
}

export async function logout({ pool, token }) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return;
  await pool.query('DELETE FROM qarzhy.sessions WHERE token_hash=$1', [hashToken(token)]);
}
