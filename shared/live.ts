import type { EndSensitivity, Modality, StartSensitivity } from '@google/genai';

// Type-only SDK import: the Worker bundles this file and must not pull in the SDK
// (running it inside the request handler measured ~10 ms CPU, the whole Workers Free budget).

export const LIVE_MODEL = 'gemini-3.8-live';

export const MODES = {
  free: 'Free talk',
  rapid: 'Rapid-fire',
  roleplay: 'Role-play',
} as const;

export type Mode = keyof typeof MODES;

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && Object.hasOwn(MODES, value);
}

/**
 * Session config shared by the Worker (locks these fields into the ephemeral token)
 * and the browser (sends the same values plus the per-connection resumption handle).
 * `sessionResumption` is deliberately absent: it must stay client-controlled.
 */
export const BASE_LIVE_CONFIG = {
  responseModalities: ['AUDIO' as Modality],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  contextWindowCompression: { slidingWindow: {} },
  realtimeInputConfig: {
    automaticActivityDetection: {
      disabled: false,
      startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH' as StartSensitivity,
      // Learners pause mid-sentence; keep end-of-turn tolerant. Tune after real sessions.
      endOfSpeechSensitivity: 'END_SENSITIVITY_LOW' as EndSensitivity,
      silenceDurationMs: 800,
    },
  },
};

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
