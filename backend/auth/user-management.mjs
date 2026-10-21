import { withTransaction } from '../db/connection.mjs';
import { hashPassword, verifyPassword } from './passwords.mjs';
import { AccessError } from './guards.mjs';

function validateUsername(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(value)) throw new AccessError('Invalid username', 422);
  return value;
}
function validateName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new AccessError('Invalid name', 422);
  return value.trim();
}
function validateRole(value) {
  if (!['admin', 'finance', 'employee'].includes(value)) throw new AccessError('Invalid role', 422);
  return value;
}

export async function updateProfile({ pool, principal, changes }) {
  return withTransaction(pool, async client => {
    const row = (await client.query('SELECT * FROM qarzhy.users WHERE id=$1 AND active=true FOR UPDATE', [principal.id])).rows[0];
    if (!row) throw new AccessError('Authentication required', 401);
    const language = changes.language ?? row.language;
    if (!['kk', 'ru'].includes(language)) throw new AccessError('Invalid language', 422);
    const username = changes.username === undefined ? row.username : validateUsername(changes.username);
    if (username !== row.username && !await verifyPassword(changes.current_password, row)) throw new AccessError('Current password is incorrect', 401);
    const updated = (await client.query(`UPDATE qarzhy.users SET username=$2,language=$3,updated_at=now(),version=version+1
      WHERE id=$1 RETURNING id,username,name,language,active,must_change_password,password_changed_at`,
      [row.id, username, language])).rows[0];
    await client.query(`INSERT INTO qarzhy.audit_log(actor_id,actor_name,action,entity_type,entity_id,before_data,after_data)
      VALUES($1,$2,'profile_update','user',$1,$3,$4)`,
      [row.id, row.name, JSON.stringify({ username: row.username, language: row.language }), JSON.stringify({ username, language })]);
    return updated;
  });
}

export async function createUser({ pool, actor, input }) {
  if (actor.role !== 'admin') throw new AccessError('Forbidden');
  const username = validateUsername(input.username);
  const name = validateName(input.name);
  const role = validateRole(input.role);
  const hashed = await hashPassword(input.password);
  return withTransaction(pool, async client => {
    const inserted = (await client.query(`INSERT INTO qarzhy.users
      (username,name,role_id,password_salt,password_hash,must_change_password,created_by)
      VALUES($1,$2,(SELECT id FROM qarzhy.roles WHERE code=$3),$4,$5,true,$6)
      RETURNING id,username,name,language,active,must_change_password`,
      [username, name, role, hashed.password_salt, hashed.password_hash, actor.id])).rows[0];
    await client.query(`INSERT INTO qarzhy.audit_log(actor_id,actor_name,action,entity_type,entity_id)
      VALUES($1,$2,'user_create','user',$3)`, [actor.id, actor.name, inserted.id]);
    return { ...inserted, role };
  });
}

export async function updateUser({ pool, actor, userId, changes }) {
  if (actor.role !== 'admin') throw new AccessError('Forbidden');
  if (!/^\d+$/.test(String(userId))) throw new AccessError('Invalid user ID', 422);
  return withTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(763425012)');
    const target = (await client.query(`SELECT u.*,r.code AS role FROM qarzhy.users u
      JOIN qarzhy.roles r ON r.id=u.role_id WHERE u.id=$1 FOR UPDATE OF u`, [userId])).rows[0];
    if (!target) throw new AccessError('User not found', 404);
    const name = changes.name === undefined ? target.name : validateName(changes.name);
    const username = changes.username === undefined ? target.username : validateUsername(changes.username);
    const role = changes.role === undefined ? target.role : validateRole(changes.role);
    const active = changes.active === undefined ? target.active : changes.active;
    if (typeof active !== 'boolean') throw new AccessError('Invalid active flag', 422);
    if (target.role === 'admin' && target.active && (!active || role !== 'admin')) {
      const count = (await client.query(`SELECT count(*)::integer AS n FROM qarzhy.users u
        JOIN qarzhy.roles r ON r.id=u.role_id WHERE r.code='admin' AND u.active=true`)).rows[0].n;
      if (count <= 1) throw new AccessError('Cannot disable the last active admin', 422);
    }
    const updated = (await client.query(`UPDATE qarzhy.users SET name=$2,username=$3,
      role_id=(SELECT id FROM qarzhy.roles WHERE code=$4),active=$5,updated_at=now(),version=version+1
      WHERE id=$1 RETURNING id,name,username,language,active,must_change_password`,
      [userId, name, username, role, active])).rows[0];
    if (!active || role !== target.role) await client.query('DELETE FROM qarzhy.sessions WHERE user_id=$1', [userId]);
    await client.query(`INSERT INTO qarzhy.audit_log(actor_id,actor_name,action,entity_type,entity_id,before_data,after_data)
      VALUES($1,$2,'user_update','user',$3,$4,$5)`,
      [actor.id, actor.name, userId,
        JSON.stringify({ name: target.name, username: target.username, role: target.role, active: target.active }),
        JSON.stringify({ name, username, role, active })]);
    return { ...updated, role };
  });
}
