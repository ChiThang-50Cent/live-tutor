import { GoogleGenAI } from '@google/genai';
import { BASE_LIVE_CONFIG, LIVE_MODEL, isMode } from '../shared/live';
import { MODE_PROMPTS } from './prompts';

interface Env {
  GEMINI_LIVE_API: string;
}

// One token per WebSocket connection; a connection lives ~10 min at most.
const TOKEN_TTL_MS = 15 * 60_000;
const NEW_SESSION_WINDOW_MS = 60_000;

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

  const now = Date.now();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_LIVE_API });
  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + TOKEN_TTL_MS).toISOString(),
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: { ...BASE_LIVE_CONFIG, systemInstruction: MODE_PROMPTS[mode] },
        },
        // Lock only the fields set above; the client keeps control of sessionResumption.
        lockAdditionalFields: [],
      },
    });
    if (!token.name) throw new Error('token response has no name');
    return Response.json({ token: token.name }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('mint token failed:', error instanceof Error ? error.message : 'unknown error');
    return Response.json({ error: 'could not mint token' }, { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/token') return mintToken(request, env);
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
