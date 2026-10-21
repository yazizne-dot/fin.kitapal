import { login, changePassword } from '../auth/accounts.mjs';
import { resetPassword } from '../auth/accounts.mjs';
import { resolveSession, logout } from '../auth/sessions.mjs';
import { createUser, updateUser, updateProfile } from '../auth/user-management.mjs';
import { passwordChangeDue } from '../auth/passwords.mjs';
import { requirePrincipal, requirePermission, AccessError } from '../auth/guards.mjs';
import { csrfToken, checkMutationRequest } from './security.mjs';
import { sendJson } from './response.mjs';

const COOKIE = 'qarzhy_session';

export function readCookie(request) {
  const pair = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  return pair?.slice(COOKIE.length + 1) || null;
}

function sessionCookie(token, expiresAt, origin) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.startsWith('https://') ? '; Secure' : ''}`;
}

function clearedCookie(origin) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${origin.startsWith('https://') ? '; Secure' : ''}`;
}

export async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new AccessError('Expected JSON body', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65_536) throw new AccessError('Request body is too large', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body;
  } catch { throw new AccessError('Invalid JSON body', 400); }
}

export function userJson(principal) {
  return {
    id: Number(principal.id),
    name: principal.name,
    username: principal.username,
    role: principal.role,
    language: principal.language,
    active: Number(Boolean(principal.active)),
    must_change_password: Number(Boolean(principal.password_change_due ?? passwordChangeDue(principal))),
    org: principal.org ?? '',
    point: principal.point ?? '',
  };
}

export function registerAccountRoutes(router, { pool, publicOrigin, csrfSecret, auth = {} }) {
  let parsedOrigin;
  try { parsedOrigin = new URL(publicOrigin); } catch { throw new Error('PUBLIC_APP_ORIGIN must be a canonical HTTP origin'); }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== publicOrigin) throw new Error('PUBLIC_APP_ORIGIN must be a canonical HTTP origin');
  if (typeof csrfSecret !== 'string' || Buffer.byteLength(csrfSecret) < 32) throw new Error('CSRF_SECRET must have at least 32 bytes');
  const services = { login, changePassword, resolveSession, logout, createUser, updateUser, updateProfile, resetPassword, ...auth };
  async function principalFor(request) {
    const token = readCookie(request);
    const principal = await services.resolveSession({ pool, token });
    return principal ? { ...principal, token } : null;
  }
  const security = { origin: publicOrigin, csrfSecret };

  router.add('POST', '/api/login', async ({ request, response, requestId }) => {
    checkMutationRequest(request, null, security);
    const body = await readJson(request);
    const result = await services.login({ pool, username: body.username, password: body.password, remember: body.remember });
    response.setHeader('set-cookie', sessionCookie(result.token, result.expiresAt, publicOrigin));
    sendJson(response, 200, { user: userJson(result.user) }, requestId);
  });

  router.add('GET', '/api/me', async ({ request, response, requestId }) => {
    const principal = requirePrincipal(await principalFor(request));
    sendJson(response, 200, { user: userJson(principal) }, requestId);
  });

  router.add('GET', '/api/csrf', async ({ request, response, requestId }) => {
    const principal = requirePrincipal(await principalFor(request));
    sendJson(response, 200, { csrf_token: csrfToken(principal.token, csrfSecret) }, requestId);
  });

  router.add('POST', '/api/password', async ({ request, response, requestId }) => {
    const principal = requirePrincipal(await principalFor(request));
    checkMutationRequest(request, principal, security);
    const body = await readJson(request);
    const result = await services.changePassword({ pool, principal, currentPassword: body.current_password, newPassword: body.new_password });
    response.setHeader('set-cookie', sessionCookie(result.token, result.expiresAt, publicOrigin));
    sendJson(response, 200, { ok: true, user: userJson(result.user) }, requestId);
  });

  router.add('POST', '/api/logout', async ({ request, response, requestId }) => {
    const principal = requirePrincipal(await principalFor(request));
    checkMutationRequest(request, principal, security);
    await services.logout({ pool, token: principal.token });
    response.setHeader('set-cookie', clearedCookie(publicOrigin));
    sendJson(response, 200, { ok: true }, requestId);
  });

  async function profileRoute({ request, response, requestId }) {
    const principal = requirePrincipal(await principalFor(request));
    checkMutationRequest(request, principal, security);
    if (principal.password_change_due) throw new AccessError('Password change required');
    const changes = await readJson(request);
    const updated = await services.updateProfile({ pool, principal, changes });
    sendJson(response, 200, { user: userJson({ ...principal, ...updated }) }, requestId);
  }
  router.add('POST', '/api/profile', profileRoute);
  router.add('PATCH', '/api/profile', profileRoute);

  router.add('GET', '/api/users', async ({ request, response, requestId }) => {
    const principal = requirePermission(await principalFor(request), 'accounts.manage');
    const rows = (await pool.query(`SELECT u.id,u.username,u.name,u.language,u.active,u.must_change_password,
      u.password_changed_at,r.code AS role,o.name AS org,l.name AS point
      FROM qarzhy.users u JOIN qarzhy.roles r ON r.id=u.role_id
      LEFT JOIN qarzhy.organizations o ON o.id=u.organization_id
      LEFT JOIN qarzhy.locations l ON l.id=u.location_id ORDER BY u.id`)).rows;
    sendJson(response, 200, { users: rows.map(userJson) }, requestId);
  });

  router.add('POST', '/api/users', async ({ request, response, requestId }) => {
    const principal = requirePermission(await principalFor(request), 'accounts.manage');
    checkMutationRequest(request, principal, security);
    const input = await readJson(request);
    const user = await services.createUser({ pool, actor: principal, input });
    sendJson(response, 201, { ok: true, user: userJson(user) }, requestId);
  });

  router.add('PATCH', '/api/users', async ({ request, response, requestId }) => {
    const principal = requirePermission(await principalFor(request), 'accounts.manage');
    checkMutationRequest(request, principal, security);
    const input = await readJson(request);
    if (input.action === 'reset-password') {
      if (typeof input.password !== 'string') throw new AccessError('Temporary password is required', 422);
      await services.resetPassword({ pool, actor: principal, userId: input.id, temporaryPassword: input.password });
      sendJson(response, 200, { ok: true }, requestId);
      return;
    }
    const user = await services.updateUser({ pool, actor: principal, userId: input.id, changes: input });
    sendJson(response, 200, { ok: true, user: userJson(user) }, requestId);
  });
}
