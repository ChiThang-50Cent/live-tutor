import { EndSensitivity, Modality, StartSensitivity, type LiveConnectConfig } from '@google/genai';

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
  responseModalities: [Modality.AUDIO],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  contextWindowCompression: { slidingWindow: {} },
  realtimeInputConfig: {
    automaticActivityDetection: {
      disabled: false,
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
      // Learners pause mid-sentence; keep end-of-turn tolerant. Tune after real sessions.
      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
      silenceDurationMs: 800,
    },
  },
} satisfies LiveConnectConfig;

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
