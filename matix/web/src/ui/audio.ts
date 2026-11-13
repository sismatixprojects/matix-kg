// Plays the peer's Opus audio (RustDesk AudioFrame) with WebCodecs + Web Audio.
export class AudioPlayer {
  private ctx: AudioContext | undefined;
  private decoder: AudioDecoder | undefined;
  private next = 0;
  private ts = 0;

  static available(): boolean {
    return typeof (globalThis as { AudioDecoder?: unknown }).AudioDecoder === "function";
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  unlock() {
    this.ctx ||= new AudioContext({ latencyHint: "interactive" });
    void this.ctx.resume();
  }

  configure(sampleRate: number, channels: number) {
    this.close(false);
    this.ctx ||= new AudioContext({ latencyHint: "interactive" });
    this.decoder = new AudioDecoder({
      output: (d) => this.play(d),
      error: (e) => console.warn("audio decoder", e),
    });
    this.decoder.configure({ codec: "opus", sampleRate, numberOfChannels: channels });
    this.ts = 0;
  }

  push(data: Uint8Array) {
    const dec = this.decoder;
    if (!dec || dec.state !== "configured") return;
    if (dec.decodeQueueSize > 20) return; // falling behind: drop rather than build latency
    dec.decode(new EncodedAudioChunk({ type: "key", timestamp: this.ts, data }));
    this.ts += 10_000;
  }

  private play(d: AudioData) {
    const ctx = this.ctx;
    if (!ctx) return d.close();
    const buf = ctx.createBuffer(d.numberOfChannels, d.numberOfFrames, d.sampleRate);
    for (let c = 0; c < d.numberOfChannels; c++) {
      const plane = new Float32Array(d.numberOfFrames);
      d.copyTo(plane, { planeIndex: c, format: "f32-planar" });
      buf.copyToChannel(plane, c);
    }
    d.close();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    // Keep ~60 ms of buffer; if we fell far behind, jump back to "now" instead of lagging.
    if (this.next < now || this.next > now + 0.5) this.next = now + 0.06;
    src.start(this.next);
    this.next += buf.duration;
  }

  close(all = true) {
    try {
      if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    } catch {
      /* ignore */
    }
    this.decoder = undefined;
    if (all) {
      void this.ctx?.close();
      this.ctx = undefined;
    }
  }
}
