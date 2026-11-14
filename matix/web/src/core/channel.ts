// A WebSocket carrying one protobuf per binary frame (how hbbs/hbbr speak to web clients).
import type { Cipher } from "./crypto";
import { t } from "../i18n";

export class ChannelClosed extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ChannelClosed";
  }
}

export class Channel {
  private ws: WebSocket;
  private queue: Uint8Array[] = [];
  private waiters: { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }[] = [];
  private closedReason: string | undefined;
  private cipher: Cipher | undefined;
  private handler: ((bytes: Uint8Array) => void) | undefined;
  onClose: ((reason: string) => void) | undefined;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => this.receive(e.data);
    ws.onclose = (e) => this.fail(e.reason || `connection closed (${e.code})`);
    ws.onerror = () => this.fail("connection error");
  }

  static open(url: string, timeoutMs = 15000): Promise<Channel> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(new Error(t("Cannot open {url}: {error}", { url, error: String(e) })));
        return;
      }
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(t("Timed out connecting to {url}", { url })));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new Channel(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(t("Failed to connect to {url}", { url })));
      };
    });
  }

  get closed(): boolean {
    return this.closedReason !== undefined;
  }

  get buffered(): number {
    return this.ws.bufferedAmount;
  }

  setCipher(cipher: Cipher) {
    this.cipher = cipher;
  }

  send(bytes: Uint8Array) {
    if (this.closed) return;
    this.ws.send(this.cipher ? this.cipher.encrypt(bytes) : bytes);
  }

  /** Waits for the next frame (decrypted). Only valid before a handler is installed. */
  next(timeoutMs = 20000): Promise<Uint8Array> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closedReason !== undefined) return Promise.reject(new ChannelClosed(this.closedReason));
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (b: Uint8Array) => {
          clearTimeout(timer);
          resolve(b);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(t("Timed out waiting for the remote side")));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Switches to push mode: every frame (queued ones first) goes to the handler. */
  setHandler(handler: (bytes: Uint8Array) => void) {
    this.handler = handler;
    while (this.queue.length) handler(this.queue.shift()!);
  }

  close(reason = "closed") {
    if (this.closed) return;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.fail(reason, true);
  }

  private receive(data: unknown) {
    if (!(data instanceof ArrayBuffer)) return;
    let bytes = new Uint8Array(data);
    if (this.cipher) {
      try {
        bytes = this.cipher.decrypt(bytes);
      } catch {
        this.close("decryption error");
        return;
      }
    }
    if (this.handler) {
      this.handler(bytes);
      return;
    }
    const w = this.waiters.shift();
    if (w) w.resolve(bytes);
    else this.queue.push(bytes);
  }

  private fail(reason: string, local = false) {
    if (this.closedReason !== undefined) return;
    this.closedReason = reason;
    for (const w of this.waiters.splice(0)) w.reject(new ChannelClosed(reason));
    if (!local) this.onClose?.(reason);
  }
}
