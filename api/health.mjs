// 직원 근태 현황 - Supabase 기능 상태 점검 전용 Vercel Function
// 기존 index.html / 로그인 / 근태 / 휴근 / 메모 코드와 완전히 분리되어 동작합니다.
// 실제 업무 데이터는 읽거나 수정하지 않고, 점검용 RPC만 호출합니다.

const SUPABASE_URL = 'https://fnzgjidzdazlodmjhmes.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_asmMoFJpUgX7rLcSkjx1PA_3n2Hk-gG';
const HEALTH_RPC = 'staff_attendance_health_check';
const UPSTREAM_TIMEOUT_MS = 10000;

function setCommonHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

export default async function handler(req, res) {
  setCommonHeaders(res);

  const isHead = req.method === 'HEAD';

  if (req.method !== 'GET' && !isHead) {
    res.setHeader('Allow', 'GET, HEAD');
    return isHead
      ? res.status(405).end()
      : res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${HEALTH_RPC}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: '{}',
      signal: controller.signal,
    });

    const rawBody = await upstream.text();

    let parsedBody = null;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {}

    const latencyMs = Date.now() - startedAt;
    const healthy = upstream.ok && parsedBody === 'OK';

    if (!healthy) {
      console.error('Supabase health check failed', {
        upstreamStatus: upstream.status,
        latencyMs,
      });

      return isHead
        ? res.status(503).end()
        : res.status(503).json({
            ok: false,
            service: 'supabase',
            upstream_status: upstream.status,
            latency_ms: latencyMs,
          });
    }

    return isHead
      ? res.status(200).end()
      : res.status(200).json({
          ok: true,
          service: 'supabase',
          latency_ms: latencyMs,
        });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const timeout = error?.name === 'AbortError';

    console.error('Supabase health check request error', {
      type: timeout ? 'timeout' : 'network',
      latencyMs,
    });

    return isHead
      ? res.status(503).end()
      : res.status(503).json({
          ok: false,
          service: 'supabase',
          error: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_REQUEST_FAILED',
          latency_ms: latencyMs,
        });
  } finally {
    clearTimeout(timeoutId);
  }
}
