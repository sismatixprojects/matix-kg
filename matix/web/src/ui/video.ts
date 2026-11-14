// Decodes RustDesk video with WebCodecs and paints it on a canvas.
import type { CodecName, EncodedFrame } from "../core/session";
import { t } from "../i18n";

const CODEC_STRINGS: Record<CodecName, string[]> = {
  vp9: ["vp09.00.10.08", "vp9"],
  vp8: ["vp8"],
  av1: ["av01.0.05M.08"],
  h264: ["avc1.42E01F", "avc1.640028"],
  h265: ["hvc1.1.6.L93.B0", "hev1.1.6.L93.B0"],
};

export function webCodecsAvailable(): boolean {
  return typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder === "function";
}

export class VideoSink {
  private decoder: VideoDecoder | undefined;
  private codec: CodecName | undefined;
  private waitingKey = true;
  private ctx: CanvasRenderingContext2D;
  private configuring: Promise<void> | undefined;
  private pending: EncodedFrame[] = [];
  frames = 0;
  onSize: ((w: number, h: number) => void) | undefined;
  onError: ((msg: string) => void) | undefined;

  constructor(readonly canvas: HTMLCanvasElement, private requestKeyFrame: () => void, private ack: () => void) {
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error(t("Canvas 2D is not available"));
    this.ctx = ctx;
  }

  push(frames: EncodedFrame[]) {
    for (const f of frames) this.pushOne(f);
  }

  private pushOne(f: EncodedFrame) {
    if (f.codec !== this.codec) {
      this.reset();
      this.codec = f.codec;
      this.configuring = this.configure(f.codec);
    }
    if (this.configuring) {
      this.pending.push(f);
      if (this.pending.length > 120) this.pending.splice(0, this.pending.length - 1);
      return;
    }
    this.decode(f);
  }

  private decode(f: EncodedFrame) {
    const dec = this.decoder;
    if (!dec || dec.state !== "configured") {
      this.ack();
      return;
    }
    if (this.waitingKey && !f.key) {
      this.ack();
      return;
    }
    if (dec.decodeQueueSize > 30) {
      // Falling behind (slow machine or background tab): drop to the next key frame.
      this.waitingKey = true;
      this.requestKeyFrame();
      this.ack();
      return;
    }
    this.waitingKey = false;
    try {
      dec.decode(new EncodedVideoChunk({ type: f.key ? "key" : "delta", timestamp: f.pts * 1000, data: f.data }));
    } catch (e) {
      this.recover(`decode failed: ${String(e)}`);
      this.ack();
    }
  }

  private async configure(codec: CodecName) {
    let chosen: VideoDecoderConfig | undefined;
    for (const c of CODEC_STRINGS[codec]) {
      const cfg: VideoDecoderConfig = { codec: c, optimizeForLatency: true, hardwareAcceleration: "no-preference" };
      try {
        if ((await VideoDecoder.isConfigSupported(cfg)).supported) {
          chosen = cfg;
          break;
        }
      } catch {
        /* try next */
      }
    }
    if (!chosen) {
      this.configuring = undefined;
      this.onError?.(t("This browser cannot decode {codec} video. Use Chrome or Edge.", { codec: codec.toUpperCase() }));
      return;
    }
    this.decoder = new VideoDecoder({
      output: (frame) => this.paint(frame),
      error: (e) => this.recover(`decoder error: ${e.message}`),
    });
    this.decoder.configure(chosen);
    this.waitingKey = true;
    this.configuring = undefined;
    const queued = this.pending.splice(0);
    if (!queued.some((f) => f.key)) this.requestKeyFrame();
    for (const f of queued) this.decode(f);
  }

  private paint(frame: VideoFrame) {
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.onSize?.(w, h);
    }
    this.ctx.drawImage(frame, 0, 0);
    frame.close();
    this.frames++;
    this.ack();
  }

  private recover(msg: string) {
    console.warn("video:", msg);
    const codec = this.codec;
    this.reset();
    if (codec) {
      this.codec = codec;
      this.configuring = this.configure(codec);
    }
    this.requestKeyFrame();
  }

  reset() {
    try {
      if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    } catch {
      /* ignore */
    }
    this.decoder = undefined;
    this.codec = undefined;
    this.waitingKey = true;
    this.pending = [];
  }
}
