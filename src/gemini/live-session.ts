import { GoogleGenAI, type LiveServerMessage, type Session } from '@google/genai';
import { BASE_LIVE_CONFIG, INPUT_SAMPLE_RATE, LIVE_MODEL, type Mode } from '../../shared/live';

export type SessionStatus = 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';
export type Speaker = 'you' | 'tutor';

export interface SessionEvents {
  status(status: SessionStatus, detail?: string): void;
  audio(pcm: Uint8Array): void;
  /** Server cancelled the tutor's turn (learner barged in): drop queued audio now. */
  interrupted(): void;
  transcript(speaker: Speaker, text: string): void;
  turnComplete(): void;
}

const MAX_CONSECUTIVE_FAILURES = 4;
const KICKOFF = 'The session has started. Begin the selected practice mode using its opening instructions.';

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * One logical tutoring session spanning many WebSocket connections.
 * Each connection gets a fresh ephemeral token; continuity comes from the
 * session-resumption handle, so GoAway / dropped sockets resume the same conversation.
 */
export class LiveTutorSession {
  private session: Session | undefined;
  private handle: string | undefined;
  /** Bumped on every (re)connect/stop so callbacks from stale sockets are ignored. */
  private generation = 0;
  private stopped = false;
  private reconnecting = false;
  private failures = 0;
  /** Socket from the in-flight reconnect closed before we finished; retry. */
  private closedWhileReconnecting = false;

  constructor(
    private readonly mode: Mode,
    private readonly events: SessionEvents,
  ) {}

  async start(): Promise<void> {
    this.events.status('connecting');
    await this.connect();
    this.session?.sendRealtimeInput({ text: KICKOFF });
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.session?.close();
    this.session = undefined;
    this.events.status('ended');
  }

  sendAudio(pcm: ArrayBuffer): void {
    // Chunks produced while reconnecting are dropped; the learner sees the status.
    if (!this.session || this.reconnecting) return;
    this.session.sendRealtimeInput({
      audio: { data: bytesToBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
    });
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    const response = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: this.mode }),
    });
    if (!response.ok) throw new Error(`token request failed (${response.status})`);
    const { token } = (await response.json()) as { token: string };

    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1beta' } });
    const session = await ai.live.connect({
      model: LIVE_MODEL,
      config: { ...BASE_LIVE_CONFIG, sessionResumption: { handle: this.handle } },
      callbacks: {
        onmessage: (message) => {
          if (generation === this.generation) this.onMessage(message);
        },
        onerror: (event) => {
          if (generation === this.generation) console.warn('live socket error', event);
        },
        onclose: (event) => {
          if (generation !== this.generation) return;
          console.warn('live socket closed', event.code, event.reason);
          if (this.reconnecting) this.closedWhileReconnecting = true;
          void this.reconnect(`closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`);
        },
      },
    });
    if (generation !== this.generation) {
      session.close();
      return;
    }
    this.session = session;
  }

  private onMessage(message: LiveServerMessage): void {
    if (message.setupComplete) {
      this.failures = 0;
      this.events.status('live');
    }
    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) this.handle = update.newHandle;
    if (message.goAway) {
      void this.reconnect('server GoAway');
      return;
    }

    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) this.events.interrupted();
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.events.audio(base64ToBytes(part.inlineData.data));
    }
    if (content.inputTranscription?.text) this.events.transcript('you', content.inputTranscription.text);
    if (content.outputTranscription?.text) this.events.transcript('tutor', content.outputTranscription.text);
    if (content.turnComplete) this.events.turnComplete();
  }

  private async reconnect(reason: string): Promise<void> {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    const previous = this.session;
    this.session = undefined;
    this.generation++;
    previous?.close();

    while (!this.stopped) {
      // Phones suspend hidden pages; attempts would fail and burn the retry budget.
      if (document.visibilityState === 'hidden') {
        const { promise, resolve } = Promise.withResolvers<void>();
        document.addEventListener('visibilitychange', () => resolve(), { once: true });
        await promise;
        continue;
      }
      if (++this.failures > MAX_CONSECUTIVE_FAILURES) {
        this.reconnecting = false;
        this.stopped = true;
        this.events.status('error', `could not reconnect after ${reason}`);
        return;
      }
      this.events.status('reconnecting', this.handle ? reason : `${reason}; no resume handle, context lost`);
      this.closedWhileReconnecting = false;
      try {
        await this.connect();
        if (!this.closedWhileReconnecting) break;
      } catch (error) {
        console.warn('reconnect attempt failed', error);
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 500 * 2 ** this.failures);
      await promise;
    }
    this.reconnecting = false;
  }
}
