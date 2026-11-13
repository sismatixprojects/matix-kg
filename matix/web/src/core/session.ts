// One remote-control session: rendezvous (hbbs) -> relay (hbbr) -> secure handshake -> login -> stream.
// Protocol reference: RustDesk src/client.rs, src/server.rs, src/rendezvous_mediator.rs and
// rustdesk-server src/rendezvous_server.rs. Web clients always go through the relay.
import { hbb as M } from "../proto/message.js";
import { hbb as R } from "../proto/rendezvous.js";
import { Channel, ChannelClosed } from "./channel";
import * as crypto from "./crypto";
import { decompress } from "./zstd";

export const PROTOCOL_VERSION = "1.5.3";

export interface ServerConfig {
  /** WebSocket URL of hbbs (port 21118 or a wss proxy in front of it). */
  idServer: string;
  /** WebSocket URL of hbbr (port 21119 or a wss proxy in front of it). */
  relayServer: string;
  /** The server's public key (contents of id_ed25519.pub). */
  key: string;
}

export interface SessionOptions {
  /** Shown to the customer as who is connecting. */
  agentName: string;
  quality?: "best" | "balanced" | "low";
  /** Ask for a file-transfer connection instead of a desktop one. */
  fileTransfer?: { dir: string; showHidden?: boolean };
}

export type CodecName = "vp9" | "vp8" | "av1" | "h264" | "h265";

export interface EncodedFrame {
  codec: CodecName;
  data: Uint8Array;
  key: boolean;
  pts: number;
  display: number;
}

export interface SessionEvents {
  status: (text: string) => void;
  /** The peer is waiting for a password (or the first one was wrong). */
  password: (wrong: boolean) => void;
  ready: (info: M.PeerInfo) => void;
  video: (frames: EncodedFrame[]) => void;
  cursorData: (c: { id: string; hotx: number; hoty: number; width: number; height: number; rgba: Uint8Array }) => void;
  cursorId: (id: string) => void;
  cursorPosition: (x: number, y: number) => void;
  clipboard: (text: string) => void;
  chat: (text: string) => void;
  switchDisplay: (d: M.ISwitchDisplay) => void;
  permission: (name: string, enabled: boolean) => void;
  messageBox: (type: string, title: string, text: string) => void;
  fileResponse: (r: M.FileResponse) => void;
  fileAction: (a: M.FileAction) => void;
  audioFormat: (sampleRate: number, channels: number) => void;
  audio: (data: Uint8Array) => void;
  /** Result of privacy mode / block input requests. */
  notice: (kind: "privacy" | "block", state: number, details: string) => void;
  /** Empty string = elevation succeeded, otherwise the error. */
  elevation: (error: string) => void;
  /** The customer's foreground window needs admin rights we don't have. */
  needsElevation: () => void;
  closed: (reason: string) => void;
}

type Listener<K extends keyof SessionEvents> = SessionEvents[K];

export class SessionError extends Error {}

function isText(format: M.ClipboardFormat | null | undefined): boolean {
  return !format || (format as number) === M.ClipboardFormat.Text;
}

export class Session {
  readonly peerId: string;
  peerInfo: M.PeerInfo | undefined;
  private channel: Channel | undefined;
  private listeners: { [K in keyof SessionEvents]?: Listener<K>[] } = {};
  private hash: M.IHash | undefined;
  private saltedPassword: Uint8Array | undefined;
  private loggedIn = false;
  private closedFlag = false;
  private readonly sessionId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

  constructor(peerId: string, private server: ServerConfig, private opts: SessionOptions) {
    this.peerId = peerId.replace(/\s+/g, "");
    this.loginDone.catch(() => {}); // callers observe failures through connect()
  }

  on<K extends keyof SessionEvents>(event: K, fn: Listener<K>): this {
    ((this.listeners[event] ||= []) as Listener<K>[]).push(fn);
    return this;
  }

  private emit<K extends keyof SessionEvents>(event: K, ...args: Parameters<SessionEvents[K]>) {
    for (const fn of this.listeners[event] || []) (fn as (...a: unknown[]) => void)(...args);
  }

  /** Connects and logs in. Resolves once the session is streaming; rejects on failure. */
  async connect(password?: string): Promise<void> {
    await crypto.ready();
    const serverKey = crypto.fromBase64(this.server.key);
    this.emit("status", "Contacting the ID server…");
    const rr = await this.rendezvous();
    this.emit("status", "Connecting through the relay…");
    const relay = await Channel.open(this.server.relayServer);
    this.channel = relay;
    relay.onClose = (reason) => this.finish(reason === "connection closed (1000)" ? "The remote side ended the session" : reason);
    relay.send(
      R.RendezvousMessage.encode({
        request_relay: {
          uuid: rr.uuid,
          licence_key: this.server.key,
          id: this.peerId,
          conn_type: this.opts.fileTransfer ? R.ConnType.FILE_TRANSFER : R.ConnType.DEFAULT_CONN,
        },
      }).finish()
    );
    this.emit("status", "Securing the connection…");
    await this.secure(relay, rr.pk, serverKey);
    this.emit("status", "Waiting for the remote side…");
    if (password) this.pendingPassword = password;
    relay.setHandler((bytes) => this.onMessage(bytes));
    await this.loginDone;
  }

  private pendingPassword: string | undefined;
  private loginResolve: (() => void) | undefined;
  private loginReject: ((e: Error) => void) | undefined;
  private loginDone = new Promise<void>((resolve, reject) => {
    this.loginResolve = resolve;
    this.loginReject = reject;
  });

  private async rendezvous(): Promise<R.RelayResponse> {
    const ch = await Channel.open(this.server.idServer).catch((e: Error) => {
      throw new SessionError(`Cannot reach the ID server (${e.message})`);
    });
    try {
      ch.send(
        R.RendezvousMessage.encode({
          punch_hole_request: {
            id: this.peerId,
            nat_type: R.NatType.SYMMETRIC, // makes the peer go through the relay
            licence_key: this.server.key,
            conn_type: this.opts.fileTransfer ? R.ConnType.FILE_TRANSFER : R.ConnType.DEFAULT_CONN,
            version: PROTOCOL_VERSION,
            force_relay: true,
          },
        }).finish()
      );
      for (;;) {
        const msg = R.RendezvousMessage.decode(await ch.next(30000));
        if (msg.punch_hole_response) {
          const r = msg.punch_hole_response;
          if (r.other_failure) throw new SessionError(r.other_failure);
          switch (r.failure) {
            case R.PunchHoleResponse.Failure.ID_NOT_EXIST:
              throw new SessionError("This ID does not exist. Check the number the customer gave you.");
            case R.PunchHoleResponse.Failure.OFFLINE:
              throw new SessionError("The remote computer is offline.");
            case R.PunchHoleResponse.Failure.LICENSE_MISMATCH:
              throw new SessionError("Server key mismatch: the web client and the server are configured with different keys.");
            case R.PunchHoleResponse.Failure.LICENSE_OVERUSE:
              throw new SessionError("Server key overuse.");
          }
          throw new SessionError("The ID server refused the connection.");
        }
        if (msg.relay_response) {
          const rr = msg.relay_response as R.RelayResponse;
          if (rr.refuse_reason) throw new SessionError(rr.refuse_reason);
          if (!rr.uuid) throw new SessionError("The ID server returned no relay session.");
          return rr;
        }
      }
    } catch (e) {
      if (e instanceof SessionError) throw e;
      if (e instanceof ChannelClosed) throw new SessionError(`The ID server closed the connection (${e.message})`);
      throw new SessionError(e instanceof Error && /Timed out/.test(e.message) ? "The remote computer did not answer. Is the MatixBridge app running?" : String(e));
    } finally {
      ch.close();
    }
  }

  /** Fail-closed handshake: any verification failure aborts the session. */
  private async secure(ch: Channel, signedPk: Uint8Array | null | undefined, serverKey: Uint8Array) {
    if (!signedPk || !signedPk.length) {
      throw new SessionError("The server did not vouch for the remote computer's key. Refusing an unencrypted session.");
    }
    let peerSignKey: Uint8Array;
    try {
      const idpk = R.IdPk.decode(crypto.signOpen(signedPk, serverKey));
      if (idpk.id !== this.peerId || idpk.pk.length !== 32) throw new Error("bad id/pk");
      peerSignKey = idpk.pk;
    } catch {
      throw new SessionError("The server's signature on the remote computer's key is invalid (wrong server key?).");
    }
    const first = M.Message.decode(await ch.next());
    if (!first.signed_id) throw new SessionError("Handshake failed: unexpected first message from the remote side.");
    let theirs: R.IdPk;
    try {
      theirs = R.IdPk.decode(crypto.signOpen(first.signed_id.id || new Uint8Array(), peerSignKey));
    } catch {
      throw new SessionError("Handshake failed: the remote computer's identity could not be verified.");
    }
    if (theirs.id !== this.peerId) throw new SessionError("Handshake failed: identity mismatch.");
    const kx = crypto.keyExchange(theirs.pk, theirs.kx_version || 0);
    ch.send(
      M.Message.encode({
        public_key: { asymmetric_value: kx.publicKey, symmetric_value: kx.sealed, kx_version: kx.picked },
      }).finish()
    );
    ch.setCipher(kx.cipher);
  }

  // ---- incoming -------------------------------------------------------------------------

  private onMessage(bytes: Uint8Array) {
    let msg: M.Message;
    try {
      msg = M.Message.decode(bytes);
    } catch (e) {
      console.warn("bad message", e);
      return;
    }
    void this.handle(msg).catch((e) => console.error("message handler", e));
  }

  private async handle(msg: M.Message) {
    switch (msg.union) {
      case "hash":
        this.hash = msg.hash!;
        if (this.pendingPassword) {
          this.saltedPassword = crypto.sha256(this.pendingPassword, this.hash.salt || "");
          this.pendingPassword = undefined;
        }
        this.sendLogin();
        if (!this.saltedPassword) this.emit("status", "Waiting for the customer to accept…");
        break;
      case "login_response": {
        const r = msg.login_response!;
        if (r.error) {
          if (/password/i.test(r.error) && !/many|attempt/i.test(r.error)) {
            const wrong = /wrong/i.test(r.error);
            this.saltedPassword = undefined;
            this.emit("password", wrong);
            this.emit("status", wrong ? "Wrong password" : "Password required");
          } else {
            this.loginReject?.(new SessionError(r.error));
            this.close(r.error);
          }
        } else if (r.peer_info) {
          this.peerInfo = r.peer_info as M.PeerInfo;
          this.loggedIn = true;
          if (!this.opts.fileTransfer && this.peerInfo.displays.length === 0) {
            this.loginReject?.(new SessionError("The remote computer has no display."));
            return;
          }
          // An installed Windows peer with several sessions (RDP) waits for us to pick one
          // before it streams; take the session it is running in, as most agents would.
          const ws = this.peerInfo.windows_sessions;
          if (ws?.sessions?.length) this.send({ misc: { selected_sid: ws.current_sid } });
          this.emit("ready", this.peerInfo);
          this.loginResolve?.();
        }
        break;
      }
      case "test_delay": {
        const td = msg.test_delay!;
        if (!td.from_client) this.send({ test_delay: td });
        break;
      }
      case "video_frame":
        this.onVideo(msg.video_frame!);
        break;
      case "cursor_data": {
        const cd = msg.cursor_data!;
        const rgba = await decompress(cd.colors || new Uint8Array());
        if (rgba) this.emit("cursorData", { id: String(cd.id), hotx: cd.hotx || 0, hoty: cd.hoty || 0, width: cd.width || 0, height: cd.height || 0, rgba });
        break;
      }
      case "cursor_id":
        this.emit("cursorId", String(msg.cursor_id));
        break;
      case "cursor_position":
        this.emit("cursorPosition", msg.cursor_position!.x || 0, msg.cursor_position!.y || 0);
        break;
      case "clipboard": {
        const cb = msg.clipboard!;
        if (!isText(cb.format)) break;
        const content = cb.compress ? await decompress(cb.content || new Uint8Array()) : cb.content;
        if (content) this.emit("clipboard", new TextDecoder().decode(content));
        break;
      }
      case "multi_clipboards": {
        for (const cb of msg.multi_clipboards?.clipboards || []) {
          if (!isText(cb.format)) continue;
          const content = cb.compress ? await decompress(cb.content!) : cb.content;
          if (content) this.emit("clipboard", new TextDecoder().decode(content));
        }
        break;
      }
      case "message_box": {
        const mb = msg.message_box!;
        this.emit("messageBox", mb.msgtype || "", mb.title || "", mb.text || "");
        break;
      }
      case "file_response":
        this.emit("fileResponse", msg.file_response as M.FileResponse);
        break;
      case "file_action":
        this.emit("fileAction", msg.file_action as M.FileAction);
        break;
      case "audio_frame":
        if (msg.audio_frame?.data?.length) this.emit("audio", msg.audio_frame.data);
        break;
      case "misc":
        this.onMisc(msg.misc!);
        break;
    }
  }

  private onVideo(vf: M.IVideoFrame) {
    const codecs: [CodecName, M.IEncodedVideoFrames | null | undefined][] = [
      ["vp9", vf.vp9s],
      ["vp8", vf.vp8s],
      ["av1", vf.av1s],
      ["h264", vf.h264s],
      ["h265", vf.h265s],
    ];
    for (const [codec, frames] of codecs) {
      if (!frames?.frames?.length) continue;
      this.emit(
        "video",
        frames.frames.map((f) => ({
          codec,
          data: f.data!,
          key: !!f.key,
          pts: Number(f.pts || 0),
          display: vf.display || 0,
        }))
      );
    }
  }

  private onMisc(misc: M.IMisc) {
    if (misc.audio_format) this.emit("audioFormat", misc.audio_format.sample_rate || 48000, misc.audio_format.channels || 2);
    else if (misc.back_notification) {
      const bn = misc.back_notification;
      if (bn.privacy_mode_state != null) this.emit("notice", "privacy", bn.privacy_mode_state, bn.details || "");
      else if (bn.block_input_state != null) this.emit("notice", "block", bn.block_input_state, bn.details || "");
    } else if (misc.elevation_response != null) this.emit("elevation", misc.elevation_response);
    else if (misc.uac || misc.foreground_window_elevated) this.emit("needsElevation");
    else if (misc.chat_message) this.emit("chat", misc.chat_message.text || "");
    else if (misc.switch_display) this.emit("switchDisplay", misc.switch_display);
    else if (misc.permission_info) {
      const p = misc.permission_info;
      const name = M.PermissionInfo.Permission[p.permission ?? 0] ?? String(p.permission);
      this.emit("permission", String(name), !!p.enabled);
    } else if (misc.close_reason) {
      this.loginReject?.(new SessionError(misc.close_reason));
      this.close(misc.close_reason);
    }
  }

  // ---- outgoing -------------------------------------------------------------------------

  send(msg: M.IMessage) {
    this.channel?.send(M.Message.encode(msg).finish());
  }

  /** Supplies (or re-supplies) the password after a `password` event. */
  login(password: string) {
    if (!this.hash) return;
    this.saltedPassword = crypto.sha256(password, this.hash.salt || "");
    this.emit("status", "Logging in…");
    this.sendLogin();
  }

  private sendLogin() {
    const p = this.saltedPassword && this.hash ? crypto.sha256(this.saltedPassword, this.hash.challenge || "") : new Uint8Array();
    const lr: M.ILoginRequest = {
      username: this.peerId,
      password: p,
      my_id: "matixbridge-web",
      my_name: this.opts.agentName || "Matix Support",
      my_platform: "Web",
      session_id: this.sessionId,
      version: PROTOCOL_VERSION,
      video_ack_required: true,
    };
    if (this.opts.fileTransfer) {
      lr.file_transfer = { dir: this.opts.fileTransfer.dir, show_hidden: !!this.opts.fileTransfer.showHidden };
    } else {
      lr.option = this.optionMessage();
    }
    this.send({ login_request: lr });
  }

  private optionMessage(): M.IOptionMessage {
    const q = this.opts.quality || "balanced";
    return {
      image_quality: q === "best" ? M.ImageQuality.Best : q === "low" ? M.ImageQuality.Low : M.ImageQuality.Balanced,
      disable_audio: M.OptionMessage.BoolOption.Yes,
      supported_decoding: {
        ability_vp9: 1,
        ability_vp8: 1,
        prefer: M.SupportedDecoding.PreferCodec.VP9,
      },
    };
  }

  /** Privacy-mode implementations the peer offers (Windows/macOS), first is the default. */
  privacyModes(): string[] {
    try {
      const add = JSON.parse(this.peerInfo?.platform_additions || "{}");
      const list = add.supported_privacy_mode_impl;
      return Array.isArray(list) ? list.map((x: unknown) => (Array.isArray(x) ? String(x[0]) : String(x))).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  setPrivacyMode(on: boolean) {
    const impl = this.privacyModes()[0] || "";
    this.send({ misc: { toggle_privacy_mode: { impl_key: impl, on } } });
  }

  setBlockInput(on: boolean) {
    const v = on ? M.OptionMessage.BoolOption.Yes : M.OptionMessage.BoolOption.No;
    this.send({ misc: { option: { block_input: v } } });
  }

  setAudio(on: boolean) {
    const v = on ? M.OptionMessage.BoolOption.No : M.OptionMessage.BoolOption.Yes;
    this.send({ misc: { option: { disable_audio: v } } });
  }

  /** Asks the customer's Windows to run MatixBridge with admin rights (UAC prompt on their side). */
  requestElevation() {
    this.send({ misc: { elevation_request: { direct: true } } });
  }

  restartRemote() {
    this.send({ misc: { restart_remote_device: true } });
  }

  videoReceived() {
    this.send({ misc: { video_received: true } });
  }

  refreshVideo() {
    this.send({ misc: { refresh_video: true } });
  }

  setQuality(q: "best" | "balanced" | "low") {
    this.opts.quality = q;
    this.send({ misc: { option: { image_quality: q === "best" ? M.ImageQuality.Best : q === "low" ? M.ImageQuality.Low : M.ImageQuality.Balanced } } });
  }

  switchDisplay(display: number) {
    this.send({ misc: { switch_display: { display } } });
  }

  chat(text: string) {
    this.send({ misc: { chat_message: { text } } });
  }

  mouse(mask: number, x: number, y: number, modifiers: M.ControlKey[] = []) {
    this.send({ mouse_event: { mask, x: Math.round(x), y: Math.round(y), modifiers } });
  }

  key(ev: M.IKeyEvent) {
    this.send({ key_event: ev });
  }

  ctrlAltDel() {
    if (this.peerInfo?.platform === "Windows") {
      this.key({ down: true, control_key: M.ControlKey.CtrlAltDel });
    } else {
      this.key({ down: true, press: true, control_key: M.ControlKey.Delete, modifiers: [M.ControlKey.Control, M.ControlKey.Alt] });
    }
  }

  lockScreen() {
    this.key({ down: true, control_key: M.ControlKey.LockScreen });
  }

  /** Types text on the remote side as a sequence (layout-independent). */
  typeText(text: string) {
    this.key({ seq: text, press: true, mode: M.KeyboardMode.Legacy });
  }

  sendClipboard(text: string) {
    this.send({ clipboard: { compress: false, content: new TextEncoder().encode(text), format: M.ClipboardFormat.Text } });
  }

  /** Bytes queued in the socket but not yet sent (for upload flow control). */
  get buffered(): number {
    return this.channel?.buffered ?? 0;
  }

  get isLoggedIn() {
    return this.loggedIn;
  }

  close(reason = "Disconnected") {
    this.finish(reason);
  }

  private finish(reason: string) {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.loginReject?.(new SessionError(reason));
    this.channel?.close(reason);
    this.emit("closed", reason);
  }
}
