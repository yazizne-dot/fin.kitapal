const REQUEST_HEADERS = ['accept', 'content-type', 'cookie', 'origin', 'x-csrf-token',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'];
const RESPONSE_HEADERS = ['content-type', 'content-disposition'];

function privateHeaders() { return { 'cache-control': 'private, no-store' }; }

export async function forwardApiRequest(request, backendOrigin, fetchApi = fetch) {
  const backend = new URL(backendOrigin);
  if (backend.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(backend.hostname) ||
      backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash)
    throw new Error('API_INTERNAL_URL must be a loopback HTTP origin');
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/')) throw new Error('Only API paths can be forwarded');
  const target = new URL(incoming.pathname + incoming.search, backend);
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  try {
    const response = await fetchApi(target, {
      method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'manual', cache: 'no-store', signal: request.signal,
    });
    const outgoing = new Headers(privateHeaders());
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) outgoing.set(name, value);
    }
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) for (const cookie of cookies) outgoing.append('set-cookie', cookie);
    else if (response.headers.get('set-cookie')) outgoing.set('set-cookie', response.headers.get('set-cookie'));
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ error: 'API unavailable' }, { status: 503, headers: privateHeaders() });
  }
}
