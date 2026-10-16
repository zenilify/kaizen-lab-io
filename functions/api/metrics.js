// Pages Function: GET /api/metrics -> the latest whitelisted snapshot from Workers KV (binding METRICS, key "metrics").
// The lab PUTs that key every 15 minutes (push-only; nothing here can reach the lab).
// When KV is empty or unbound, answer 503 so the page falls back to the bundled /data/metrics.json.
export async function onRequestGet({ env }) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=60',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
  };
  if (!env.METRICS) {
    return new Response(JSON.stringify({ error: 'feed not configured' }), { status: 503, headers });
  }
  const raw = await env.METRICS.get('metrics', { cacheTtl: 60 });
  if (!raw) {
    return new Response(JSON.stringify({ error: 'no snapshot yet' }), { status: 503, headers });
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) {
    return new Response(JSON.stringify({ error: 'bad snapshot' }), { status: 502, headers });
  }
  return new Response(JSON.stringify(data), { status: 200, headers });
}

export async function onRequestHead(ctx) {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'allow': 'GET, OPTIONS' } });
  return new Response('Method not allowed', { status: 405, headers: { 'allow': 'GET, OPTIONS' } });
}
