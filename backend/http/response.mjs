import { randomUUID } from 'node:crypto';

export function sendJson(response, status, body, requestId = randomUUID()) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-request-id': requestId,
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

export function sendError(response, status, message, requestId) {
  sendJson(response, status, { error: message, request_id: requestId }, requestId);
}
