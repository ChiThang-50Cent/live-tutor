import { OUTPUT_SAMPLE_RATE } from '../../shared/live';

// Small lead so back-to-back chunks don't underrun when the queue is empty.
const START_LEAD_S = 0.05;

/** Gapless queue for 24 kHz PCM16 chunks; `clear()` drops everything instantly (barge-in). */
export class PcmPlayer {
  private nextStart = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly onPlayingChange: (playing: boolean) => void,
  ) {}

  enqueue(pcm: Uint8Array): void {
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1);
    if (samples.length === 0) return;
    const buffer = this.ctx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    this.nextStart = Math.max(this.nextStart, this.ctx.currentTime + START_LEAD_S);
    source.start(this.nextStart);
    this.nextStart += buffer.duration;

    if (this.sources.size === 0) this.onPlayingChange(true);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.onPlayingChange(false);
    };
  }

  clear(): void {
    if (this.sources.size === 0) return;
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
    }
    this.sources.clear();
    this.nextStart = 0;
    this.onPlayingChange(false);
  }
}
