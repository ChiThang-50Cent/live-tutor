import { BASE_LIVE_CONFIG, LIVE_MODEL, isMode } from '../shared/live';
import { MODE_PROMPTS } from './prompts';

interface Env {
  GEMINI_LIVE_API: string;
}

// Plain REST instead of @google/genai: with the SDK, /api/token measured ~10 ms CPU
// per request, the entire Workers Free per-request budget.
const AUTH_TOKENS_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';

// One token per WebSocket connection; a connection lives ~10 min at most.
const TOKEN_TTL_MS = 15 * 60_000;
const NEW_SESSION_WINDOW_MS = 60_000;

/**
 * Lock exactly the fields we set (SDK `lockAdditionalFields: []` semantics):
 * one mask entry per top-level key, or per child key for non-empty objects.
 * Anything absent — notably `sessionResumption` — stays client-controlled.
 */
function lockMask(setup: Record<string, unknown>): string {
  return Object.entries(setup)
    .flatMap(([key, value]) =>
      value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
        ? Object.keys(value).map((child) => `${key}.${child}`)
        : [key],
    )
    .join(',');
}

async function mintToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const body: unknown = await request.json().catch(() => null);
  const mode = (body as { mode?: unknown } | null)?.mode;
  if (!isMode(mode)) {
    return Response.json({ error: 'invalid mode' }, { status: 400 });
  }
  if (!env.GEMINI_LIVE_API) {
    return Response.json({ error: 'GEMINI_LIVE_API is not configured' }, { status: 500 });
  }

  const { responseModalities, ...rest } = BASE_LIVE_CONFIG;
  const setup = {
    model: `models/${LIVE_MODEL}`,
    generationConfig: { responseModalities },
    systemInstruction: { parts: [{ text: MODE_PROMPTS[mode] }], role: 'user' },
    ...rest,
  };
  const now = Date.now();
  const upstream = await fetch(AUTH_TOKENS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_LIVE_API },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + TOKEN_TTL_MS).toISOString(),
      newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
      bidiGenerateContentSetup: setup,
      fieldMask: lockMask(setup),
    }),
  });
  if (!upstream.ok) {
    console.error('mint token failed:', upstream.status, (await upstream.text()).slice(0, 500));
    return Response.json({ error: 'could not mint token' }, { status: 502 });
  }
  const { name } = (await upstream.json()) as { name?: string };
  if (!name) return Response.json({ error: 'could not mint token' }, { status: 502 });
  return Response.json({ token: name }, { headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/token') return mintToken(request, env);
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
