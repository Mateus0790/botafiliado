import { withRetry } from './retry.js';

const timeoutMs = () => Number(process.env.REQUEST_TIMEOUT_MS || 15000);

export async function requestJson(url, options = {}) {
  return withRetry(async () => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs()) });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!response.ok) {
      const error = new Error(body.message || body.error_description || `API respondeu HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      error.retryAfterMs = Number(response.headers.get('retry-after')) * 1000;
      throw error;
    }
    return body;
  });
}

/** Segue os redirecionamentos de um link curto (s.shopee, s.click.aliexpress, mercadolivre.com/sec...) e devolve a URL final. */
export async function resolveFinalUrl(url) {
  return withRetry(async () => {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs()), headers: { 'user-agent': 'Mozilla/5.0 botafiliado' } });
    await response.body?.cancel();
    return response.url || url;
  });
}
