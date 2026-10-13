import { INPUT_SAMPLE_RATE } from '../../shared/live';
import workletUrl from './pcm16-capture.worklet.js?url';

const CHUNK_MS = 40;

export interface MicCapture {
  setMuted(muted: boolean): void;
  stop(): void;
}

/**
 * Streams the mic as 16 kHz PCM16 chunks through `ctx`.
 * `onEnded` fires when the OS kills the track (iOS phone call, Siri, another app taking the mic).
 */
export async function startMicCapture(
  ctx: AudioContext,
  onChunk: (pcm: ArrayBuffer) => void,
  onEnded: () => void,
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const [track] = stream.getAudioTracks();
  track.addEventListener('ended', onEnded, { once: true });
  const source = ctx.createMediaStreamSource(stream);
  // Zero outputs: the node is a sink and is processed without connecting to destination.
  const node = new AudioWorkletNode(ctx, 'pcm16-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { targetRate: INPUT_SAMPLE_RATE, chunkMs: CHUNK_MS },
  });
  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onChunk(event.data);
  source.connect(node);

  return {
    setMuted(muted) {
      node.port.postMessage({ type: 'mute', value: muted });
    },
    stop() {
      track.removeEventListener('ended', onEnded);
      node.port.onmessage = null;
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
