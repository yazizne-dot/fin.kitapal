import { createHmac, timingSafeEqual } from 'node:crypto';

export class RequestSecurityError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

export function csrfToken(sessionToken, secret) {
  if (!secret || !sessionToken) throw new Error('CSRF secret and session token are required');
  return createHmac('sha256', secret).update('qarzhy-csrf-v1:').update(sessionToken).digest('hex');
}

export function checkMutationRequest(request, principal, { origin, csrfSecret }) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (!origin) throw new Error('PUBLIC_APP_ORIGIN is required');
  if (request.headers.origin !== origin) throw new RequestSecurityError('Origin check failed');
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin') throw new RequestSecurityError('Cross-site request rejected');
  if (!principal) return;
  const expected = Buffer.from(csrfToken(principal.token, csrfSecret), 'hex');
  const supplied = request.headers['x-csrf-token'];
  if (typeof supplied !== 'string' || !/^[0-9a-f]{64}$/.test(supplied)) throw new RequestSecurityError('CSRF token is required');
  if (!timingSafeEqual(expected, Buffer.from(supplied, 'hex'))) throw new RequestSecurityError('CSRF token is invalid');
}
