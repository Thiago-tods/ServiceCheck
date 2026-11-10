/**
 * HTTP calls for the demo seed.
 *
 * A response body is only ever parsed, never copied into a message or kept as text. Every failure
 * becomes a SeedError with a short, friendly message, including a timeout while the
 * response body is still being read (the signal covers headers AND body, so a server that sends the
 * headers and then stalls ends the same way as one that never answers). Messages say what failed
 * ("GET /clients") and nothing else: never the server address, a token, a password or a body.
 */
import { SeedError } from './seed-core.mjs';

// The routes the seed calls are a closed set. Their fixed words are listed here; anything else in a
// path is a value that came from the server (an id) and is shown as ":id", whatever its format.
const COLLECTIONS = new Set(['clients', 'services', 'work-orders', 'members', 'companies']);
const FIXED_SEGMENTS = new Set([
  ...COLLECTIONS,
  'auth',
  'register',
  'login',
  'me',
  'health',
  'addresses',
  'checklist-versions',
  'assignments',
]);

/**
 * "/clients/tok-fict-leak/addresses?limit=200" becomes "/clients/:id/addresses". The query string is
 * dropped, the fixed words of the seed's routes are kept so the operation stays identifiable, the
 * segment right after a collection is always an id (even one that looks like a fixed word), and any
 * other segment is masked. Identifiers do not belong in messages, in any format.
 */
export function routeOf(path) {
  const segments = String(path).split(/[?#]/)[0].split('/').filter(Boolean);
  const masked = [];
  let afterCollection = false;
  for (const segment of segments) {
    if (afterCollection) {
      masked.push(':id');
      afterCollection = false;
    } else if (FIXED_SEGMENTS.has(segment)) {
      masked.push(segment);
      afterCollection = COLLECTIONS.has(segment);
    } else {
      masked.push(':id');
    }
  }
  return `/${masked.join('/')}`;
}

function describeFailure(error, what, timeoutMs) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return (
      `a API não respondeu por completo em ${timeoutMs / 1000}s (${what}). ` +
      'O backend está travado ou muito lento?'
    );
  }
  const code = error?.cause?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `não consegui falar com a API (${what}: ${code}). O backend está rodando?`;
  }
  if (error?.message === 'terminated' || code === 'UND_ERR_SOCKET' || code === 'ECONNRESET') {
    return `a conexão com a API foi interrompida durante a resposta (${what}).`;
  }
  return `falha de rede ao chamar a API (${what}${code ? `: ${code}` : ''}).`;
}

/** @returns async (method, path, { token, companyId, body }) => ({ status, body }) */
export function makeHttpCall(baseUrl, { timeoutMs = 10_000 } = {}) {
  return async (method, path, { token, companyId, body } = {}) => {
    const what = `${method} ${routeOf(path)}`;
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (companyId) headers['x-company-id'] = companyId;
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Read the body inside the same try: the timeout also applies while it is being received.
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {}; // not JSON: keep nothing of the text, it is never shown
      }
      return { status: res.status, body: json };
    } catch (error) {
      throw new SeedError(describeFailure(error, what, timeoutMs));
    }
  };
}
