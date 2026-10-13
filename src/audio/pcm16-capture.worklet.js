// Mono mic → 16 kHz PCM16 chunks. Box-filter decimation (average every `ratio`
// input samples) doubles as a cheap anti-aliasing low-pass.
class Pcm16Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetRate, chunkMs } = options.processorOptions;
    this.ratio = sampleRate / targetRate;
    this.chunkSize = Math.round((targetRate * chunkMs) / 1000);
    this.chunk = new Int16Array(this.chunkSize);
    this.filled = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.muted = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'mute') this.muted = event.data.value;
    };
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      this.sum += samples[i];
      this.count++;
      this.phase++;
      if (this.phase < this.ratio) continue;
      this.phase -= this.ratio;
      const value = this.muted ? 0 : Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.chunk[this.filled++] = value < 0 ? value * 0x8000 : value * 0x7fff;
      if (this.filled === this.chunkSize) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(this.chunkSize);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm16-capture', Pcm16Capture);
