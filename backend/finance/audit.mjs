export async function audit(client, principal, action, entityType, entityId, details = {}) {
  await client.query(`INSERT INTO qarzhy.audit_log
    (actor_id,actor_name,action,entity_type,entity_id,before_data,after_data,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [principal.id, principal.name, action, entityType, entityId,
    details.before ? JSON.stringify(details.before) : null,
    details.after ? JSON.stringify(details.after) : null,
    details.reason ?? null]);
}
