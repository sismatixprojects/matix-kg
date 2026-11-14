// The agent's microphone during a voice call: captured with Web Audio, encoded to Opus with
// WebCodecs, and handed out frame by frame. The customer's MatixBridge plays it (RustDesk's
// misc.audio_format + audio_frame, as the desktop app sends during a call); the customer's voice
// comes back as ordinary audio frames, played by AudioPlayer.
export class MicSender {
  private ctx: AudioContext | undefined;
  private stream: MediaStream | undefined;
  private node: ScriptProcessorNode | undefined;
  private enc: AudioEncoder | undefined;
  private ts = 0;

  static available(): boolean {
    return typeof (globalThis as { AudioEncoder?: unknown }).AudioEncoder === "function" && !!navigator.mediaDevices?.getUserMedia;
  }

  /** Asks for the microphone. Call it from the click, so the browser can show its prompt and start audio. */
  async prepare() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    void this.ctx.resume();
  }

  /** Starts sending: onFormat once, then onFrame for every Opus packet. */
  start(onFormat: (sampleRate: number, channels: number) => void, onFrame: (data: Uint8Array) => void) {
    const ctx = this.ctx;
    if (!ctx || !this.stream || this.node) return;
    const rate = ctx.sampleRate;
    const enc = new AudioEncoder({
      output: (chunk) => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        onFrame(b);
      },
      error: (e) => console.warn("microphone encoder", e),
    });
    enc.configure({ codec: "opus", sampleRate: rate, numberOfChannels: 1, bitrate: 32000 });
    this.enc = enc;
    onFormat(rate, 1);
    this.ts = 0;
    const src = ctx.createMediaStreamSource(this.stream);
    const node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (e) => {
      if (enc.state !== "configured") return;
      const pcm = e.inputBuffer.getChannelData(0).slice();
      const data = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: this.ts, data: pcm });
      this.ts += Math.round((pcm.length / rate) * 1e6);
      enc.encode(data);
      data.close();
    };
    // A script processor only runs while connected to the output; route it through silence.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    src.connect(node);
    node.connect(silent);
    silent.connect(ctx.destination);
    this.node = node;
  }

  stop() {
    if (this.node) this.node.onaudioprocess = null;
    this.node?.disconnect();
    this.node = undefined;
    try {
      if (this.enc && this.enc.state !== "closed") this.enc.close();
    } catch {
      /* ignore */
    }
    this.enc = undefined;
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
