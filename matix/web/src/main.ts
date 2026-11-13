// MatixBridge web client: agent-side remote control in the browser.
import { hbb as M } from "./proto/message.js";
import { Session, SessionError, type ServerConfig } from "./core/session";
import { FileSession, type RemoteDir, type RemoteEntry } from "./core/files";
import { VideoSink, webCodecsAvailable } from "./ui/video";
import { mapKey, remoteOs, type RemoteOs } from "./ui/keymap";
import { book, displayName, osLabel, timeAgo, type Device } from "./ui/addressbook";
import { AudioPlayer } from "./ui/audio";

const MOUSE_MOVE = 0, MOUSE_DOWN = 1, MOUSE_UP = 2, MOUSE_WHEEL = 3;
const BUTTONS = [0x01, 0x04, 0x02, 0x08, 0x10]; // DOM button index -> RustDesk button bit

const app = document.getElementById("app")!;

// ---------- small helpers ----------
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

const ICONS: Record<string, string> = {
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  rec: '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
  clip: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fit: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8M12 8v8"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
};
function icon(name: string) {
  const span = document.createElement("span");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
  return span.firstElementChild!;
}
function tb(name: string, label: string, title = label) {
  const b = h("button", { class: "tb", title });
  b.append(icon(name), h("span", { class: "label" }, label));
  return b;
}

const toasts = h("div", { class: "toasts" });
document.body.append(toasts);
function toast(text: string, err = false, ms = 4000) {
  const t = h("div", { class: "toast" + (err ? " err" : "") }, text);
  toasts.append(t);
  setTimeout(() => t.remove(), ms);
}

const store = {
  get(k: string) {
    try {
      return localStorage.getItem("matixbridge." + k) || "";
    } catch {
      return "";
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem("matixbridge." + k, v);
    } catch {
      /* private mode */
    }
  },
};

function formatId(id: string) {
  // Group digits in threes from the right, like the desktop app: "1 465 118 012".
  return id.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
function saveBlob(blob: Blob, name: string) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ---------- config ----------
async function loadConfig(): Promise<ServerConfig> {
  const q = new URLSearchParams(location.search);
  let cfg: Partial<ServerConfig> = {};
  try {
    const r = await fetch("./config.json", { cache: "no-store" });
    if (r.ok) cfg = await r.json();
  } catch {
    /* fall through to query params */
  }
  // Dev builds only: ?idServer=ws://host:21118&relayServer=ws://host:21119&key=...
  // Production must never take the server or its key from a link: the key is the trust anchor.
  if (import.meta.env.DEV) {
    for (const k of ["idServer", "relayServer", "key"] as const) {
      const v = q.get(k);
      if (v) cfg[k] = v;
    }
  }
  if (!cfg.idServer || !cfg.relayServer || !cfg.key || cfg.key.startsWith("REPLACE")) {
    throw new Error("The web client is not configured (config.json is missing the server addresses or key).");
  }
  return cfg as ServerConfig;
}

// ---------- connect screen ----------
function connectScreen(cfg: ServerConfig, error = "") {
  app.replaceChildren();
  const id = h("input", { class: "field big", inputmode: "numeric", autocomplete: "off", placeholder: "123 456 789", id: "peer-id" });
  const pw = h("input", { class: "field", type: "password", autocomplete: "off", placeholder: "Leave empty to ask the customer to accept", id: "peer-pw" });
  const agent = h("input", { class: "field", placeholder: "Your name", id: "agent" });
  agent.value = store.get("agent");
  const err = h("div", { class: "error" }, error);
  const go = h("button", { class: "btn primary wide", type: "submit" }, "Connect");
  id.addEventListener("input", () => {
    id.value = formatId(id.value);
  });
  const form = h(
    "form",
    { class: "card" },
    h("div", { class: "brand" }, h("img", { src: "./favicon.svg", alt: "" }), h("div", {}, h("h1", {}, "MatixBridge"), h("p", {}, "Remote support"))),
    h("label", { for: "peer-id" }, "Customer's MatixBridge ID"),
    id,
    h("label", { for: "peer-pw" }, "Password"),
    pw,
    h("div", { class: "hint" }, "Ask the customer to read you the ID shown in their MatixBridge app. Without a password, they will be asked to accept the connection."),
    h("label", { for: "agent" }, "Shown to the customer as"),
    agent,
    go,
    err
  );
  const opts = h("label", {}, h("input", { type: "checkbox", id: "files-only" }), " Open file transfer only");
  opts.style.display = "flex";
  opts.style.gap = "8px";
  opts.style.alignItems = "center";
  form.insertBefore(opts, go);
  form.onsubmit = (e) => {
    e.preventDefault();
    const peer = id.value.replace(/\D/g, "");
    if (peer.length < 6) {
      err.textContent = "Enter the customer's ID.";
      return;
    }
    store.set("agent", agent.value.trim());
    const filesOnly = (document.getElementById("files-only") as HTMLInputElement).checked;
    if (filesOnly) void filesScreen(cfg, peer, pw.value, agent.value.trim() || "Matix Support");
    else void sessionScreen(cfg, peer, pw.value, agent.value.trim() || "Matix Support");
  };
  const start = (peer: string, filesOnly: boolean) => {
    id.value = formatId(peer);
    (document.getElementById("files-only") as HTMLInputElement).checked = filesOnly;
    form.requestSubmit();
  };
  const panel = addressBookPanel((peer) => {
    id.value = formatId(peer);
    pw.focus();
  }, start);
  app.append(h("div", { class: "connect" }, h("div", { class: "connect-grid" }, form, panel), h("div", { class: "footer" }, "MatixBridge · based on RustDesk (AGPL-3.0)")));
  if (!webCodecsAvailable()) err.textContent = "This browser cannot show remote screens (no WebCodecs). Use Chrome, Edge or Safari 16.4+.";
  id.focus();
}

// ---------- password prompt ----------
function promptPassword(overlay: HTMLElement, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { class: "field", type: "password", placeholder: "Password", autocomplete: "off" });
    const ok = h("button", { class: "btn primary", type: "submit" }, "Log in");
    const cancel = h("button", { class: "btn", type: "button" }, "Cancel");
    const form = h(
      "form",
      { class: "box" },
      h("h3", {}, wrong ? "Wrong password" : "Password required"),
      h("p", { class: "hint" }, "Enter the password shown on the customer's computer."),
      input,
      h("div", { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:14px" }, cancel, ok)
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      overlay.replaceChildren();
      resolve(input.value);
    };
    cancel.onclick = () => {
      overlay.replaceChildren();
      resolve(null);
    };
    overlay.replaceChildren(form);
    overlay.classList.remove("hidden");
    input.focus();
  });
}

function statusBox(overlay: HTMLElement, text: string, spinner = true) {
  overlay.replaceChildren(h("div", { class: "box" }, ...(spinner ? [h("div", { class: "spinner" })] : []), h("div", {}, text)));
  overlay.classList.remove("hidden");
}

// ---------- remote session ----------
async function sessionScreen(cfg: ServerConfig, peerId: string, password: string, agentName: string) {
  app.replaceChildren();
  const canvas = h("canvas", { tabindex: "0", width: "1280", height: "720" });
  const overlay = h("div", { class: "overlay" });
  const stage = h("div", { class: "stage" }, canvas, overlay);
  const drawerHost = h("div", { class: "drawer hidden" });
  const title = h("div", { class: "title", title: "Click to name this device" }, h("b", {}, formatId(peerId)), h("span", {}, "Connecting…"));
  title.style.cursor = "pointer";
  title.onclick = () => {
    const cur = book.get(peerId);
    const name = window.prompt("Name for this device (e.g. customer or company):", cur?.name || "");
    if (name === null) return;
    book.upsert(peerId, { name: name.trim() });
    (title.firstChild as HTMLElement).textContent = name.trim() ? `${name.trim()} · ${formatId(peerId)}` : formatId(peerId);
    canvas.focus();
  };

  const bDisplay = h("label", { class: "tb hidden", title: "Remote display" });
  const displaySel = h("select");
  bDisplay.append(displaySel);
  const qualitySel = h("select", { title: "Image quality" });
  for (const [v, l] of [["balanced", "Balanced"], ["best", "Best quality"], ["low", "Fast (low quality)"]]) qualitySel.append(h("option", { value: v }, l));
  const bQuality = h("label", { class: "tb", title: "Image quality" }, qualitySel);
  const bCad = tb("keyboard", "Ctrl+Alt+Del");
  const bLock = tb("lock", "Lock", "Lock the remote screen");
  const bRefresh = tb("refresh", "Refresh", "Refresh the picture");
  const bType = tb("type", "Type text", "Type a text on the remote computer");
  const bClip = tb("clip", "Send clipboard", "Send your clipboard text to the remote computer");
  const bFit = tb("fit", "Fit", "Switch between fit-to-window and actual size");
  const bChat = tb("chat", "Chat");
  const chatBadge = h("span", { class: "badge hidden" }, "1");
  bChat.append(chatBadge);
  const bFiles = tb("files", "Files");
  const bRec = tb("rec", "Record", "Record this session to a video file");
  bRec.classList.add("rec");
  const bFull = tb("full", "Full screen");
  const bClose = tb("close", "Disconnect");
  for (const b of [bCad, bLock, bRefresh, bType, bClip, bFit, bFull]) b.classList.add("compact");
  const bMore = h("button", { class: "tb", title: "More controls" }, h("span", {}, "More ▾"));
  const moreMenu = h("div", { class: "tb-menu hidden" });
  const moreWrap = h("div", { class: "tb-menu-wrap" }, bMore, moreMenu);
  bClose.classList.add("danger");

  const toolbar = h("div", { class: "toolbar" }, title, bDisplay, bQuality, bCad, bLock, bRefresh, bType, bClip, bFit, moreWrap, h("div", { class: "spacer" }), bChat, bFiles, bRec, bFull, bClose);
  const root = h("div", { class: "session" }, toolbar, h("div", { class: "body" }, stage, drawerHost));
  app.append(root);
  statusBox(overlay, "Connecting…");

  const session = new Session(peerId, cfg, { agentName, quality: "balanced" });
  let os: RemoteOs = "windows";
  let display = { x: 0, y: 0, width: 1280, height: 720 };
  let ended = false;
  let firstFrame = false;

  const video = new VideoSink(canvas, () => session.refreshVideo(), () => session.videoReceived());
  video.onError = (m) => statusBox(overlay, m, false);
  video.onSize = () => {
    if (!firstFrame) {
      firstFrame = true;
      overlay.classList.add("hidden");
      overlay.replaceChildren();
      canvas.focus();
    }
  };

  // cursor shapes
  const cursors = new Map<string, string>();
  const cursorCanvas = document.createElement("canvas");
  session.on("cursorData", (c) => {
    if (!c.width || !c.height) return;
    cursorCanvas.width = c.width;
    cursorCanvas.height = c.height;
    const ctx = cursorCanvas.getContext("2d")!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(c.rgba.buffer, c.rgba.byteOffset, c.width * c.height * 4), c.width, c.height), 0, 0);
    const css = `url(${cursorCanvas.toDataURL()}) ${c.hotx} ${c.hoty}, default`;
    cursors.set(c.id, css);
    canvas.style.cursor = css;
  });
  session.on("cursorId", (id) => {
    const css = cursors.get(id);
    if (css) canvas.style.cursor = css;
  });

  session.on("status", (s) => {
    if (!firstFrame) statusBox(overlay, s);
  });
  session.on("video", (frames) => video.push(frames));
  session.on("switchDisplay", (d) => {
    display = { x: d.x || 0, y: d.y || 0, width: d.width || display.width, height: d.height || display.height };
    if (typeof d.display === "number") displaySel.value = String(d.display);
  });
  session.on("permission", (name, enabled) => toast(`Customer ${enabled ? "allowed" : "blocked"}: ${name}`));
  session.on("messageBox", (type, t, text) => {
    if (type === "custom-nocancel" || type === "custom" || type === "info" || type === "error") toast(`${t}: ${text}`, type === "error");
  });
  session.on("clipboard", async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Remote clipboard copied to your clipboard", false, 2000);
    } catch {
      /* page not focused or permission denied: ignore silently */
    }
  });
  session.on("closed", (reason) => {
    if (ended) return;
    ended = true;
    stopRecording();
    video.reset();
    releaseKeys();
    teardown();
    connectScreen(cfg, reason === "Disconnected" ? "" : reason);
  });

  session.on("ready", (pi) => {
    os = remoteOs(pi.platform);
    book.record(peerId, { host: pi.hostname, user: pi.username, platform: pi.platform });
    const saved = book.get(peerId);
    if (saved?.name) (title.firstChild as HTMLElement).textContent = `${saved.name} · ${formatId(peerId)}`;
    (title.lastChild as HTMLElement).textContent = `${pi.username || ""}@${pi.hostname || ""} · ${pi.platform}`;
    displaySel.replaceChildren();
    pi.displays.forEach((d, i) => displaySel.append(h("option", { value: String(i) }, `Display ${i + 1} (${d.width}×${d.height})`)));
    bDisplay.classList.toggle("hidden", pi.displays.length < 2);
    const cur = pi.displays[pi.current_display || 0] || pi.displays[0];
    if (cur) display = { x: cur.x || 0, y: cur.y || 0, width: cur.width || 1280, height: cur.height || 720 };
    displaySel.value = String(pi.current_display || 0);
    statusBox(overlay, "Connected, waiting for the picture…");
  });
  session.on("password", async (wrong) => {
    const p = await promptPassword(overlay, wrong);
    if (p === null) session.close("Disconnected");
    else session.login(p);
  });

  // ---- chat ----
  const chatLog = h("div", { class: "chat-log" });
  const chatInput = h("input", { class: "field", placeholder: "Message the customer…" });
  const chatForm = h("form", { class: "chat-form" }, chatInput, h("button", { class: "btn primary", type: "submit" }, "Send"));
  const chatPanel = h("div", { class: "files" }, h("header", {}, "Chat", closeX()), chatLog, chatForm);
  chatForm.onsubmit = (e) => {
    e.preventDefault();
    const t = chatInput.value.trim();
    if (!t) return;
    session.chat(t);
    chatLog.append(h("div", { class: "msg me" }, t));
    chatLog.scrollTop = chatLog.scrollHeight;
    chatInput.value = "";
  };
  session.on("chat", (t) => {
    chatLog.append(h("div", { class: "msg them" }, t));
    chatLog.scrollTop = chatLog.scrollHeight;
    if (drawerHost.dataset.panel !== "chat") {
      chatBadge.classList.remove("hidden");
      toast(`Customer: ${t}`);
    }
  });

  function closeX() {
    const x = h("button", { class: "x", type: "button", title: "Close" }, "×");
    x.onclick = () => showPanel(null);
    return x;
  }

  // ---- files ----
  let filesUi: FilesPanel | undefined;
  function showPanel(name: "chat" | "files" | null) {
    if (!name || drawerHost.dataset.panel === name) {
      drawerHost.classList.add("hidden");
      drawerHost.dataset.panel = "";
      bChat.classList.remove("on");
      bFiles.classList.remove("on");
      canvas.focus();
      return;
    }
    drawerHost.dataset.panel = name;
    drawerHost.classList.remove("hidden");
    bChat.classList.toggle("on", name === "chat");
    bFiles.classList.toggle("on", name === "files");
    if (name === "chat") {
      chatBadge.classList.add("hidden");
      drawerHost.replaceChildren(chatPanel);
      chatInput.focus();
    } else {
      filesUi ||= new FilesPanel(cfg, peerId, password, agentName, () => showPanel(null));
      drawerHost.replaceChildren(filesUi.el);
      void filesUi.open();
    }
  }
  bChat.onclick = () => showPanel("chat");
  bFiles.onclick = () => showPanel("files");

  // ---- toolbar actions ----
  bCad.onclick = () => session.ctrlAltDel();
  bLock.onclick = () => session.lockScreen();
  bRefresh.onclick = () => session.refreshVideo();
  bClose.onclick = () => session.close("Disconnected");
  qualitySel.onchange = () => session.setQuality(qualitySel.value as "best" | "balanced" | "low");
  displaySel.onchange = () => session.switchDisplay(Number(displaySel.value));
  bFit.onclick = () => {
    stage.classList.toggle("actual");
    bFit.classList.toggle("on", stage.classList.contains("actual"));
  };
  bType.onclick = () => {
    const t = window.prompt("Text to type on the remote computer:");
    if (t) session.typeText(t);
    canvas.focus();
  };
  bClip.onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return toast("Your clipboard has no text.");
      session.sendClipboard(t);
      toast("Clipboard sent. Press Ctrl+V on the remote computer.", false, 2500);
    } catch {
      toast("The browser blocked clipboard access. Allow it in the address bar.", true);
    }
    canvas.focus();
  };
  bFull.onclick = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await root.requestFullscreen().catch(() => {});
    // Chromium: capture Alt+Tab, Win, Esc… while full screen.
    const kb = (navigator as unknown as { keyboard?: { lock?: () => Promise<void> } }).keyboard;
    await kb?.lock?.().catch(() => {});
  };

  // ---- more controls: sound, block input, privacy mode, elevation, restart ----
  const audio = new AudioPlayer();
  const ctl = { sound: false, block: false, privacy: false };
  let warnedElevation = false;
  function menuItem(label: string, onClick: () => void, opts: { checked?: boolean; disabled?: string } = {}) {
    const b = h("button", { type: "button" }, h("span", { class: "ck-mark" }, opts.checked ? "✓" : ""), h("span", {}, label));
    if (opts.disabled) {
      b.setAttribute("disabled", "");
      b.title = opts.disabled;
    }
    b.onclick = (e) => {
      e.stopPropagation();
      moreMenu.classList.add("hidden");
      onClick();
      canvas.focus();
    };
    return b;
  }
  function buildMenu() {
    const isWin = os === "windows";
    const privacyOk = session.privacyModes().length > 0;
    moreMenu.replaceChildren(
      menuItem("Sound from the remote computer", () => {
        if (!AudioPlayer.available()) return toast("This browser cannot play remote sound. Use Chrome or Edge.", true);
        ctl.sound = !ctl.sound;
        if (ctl.sound) audio.unlock();
        session.setAudio(ctl.sound);
        toast(ctl.sound ? "Remote sound on" : "Remote sound off", false, 1500);
      }, { checked: ctl.sound }),
      menuItem("Block the customer's mouse and keyboard", () => {
        ctl.block = !ctl.block;
        session.setBlockInput(ctl.block);
      }, { checked: ctl.block, disabled: isWin ? "" : "Only Windows computers support this" }),
      menuItem("Privacy mode: black out the customer's screen", () => {
        ctl.privacy = !ctl.privacy;
        session.setPrivacyMode(ctl.privacy);
        toast(ctl.privacy ? "Turning privacy mode on…" : "Turning privacy mode off…", false, 1500);
      }, { checked: ctl.privacy, disabled: privacyOk ? "" : "The remote computer does not support privacy mode" }),
      h("hr"),
      menuItem("Request admin rights (UAC)", () => {
        session.requestElevation();
        toast("Asked the customer to allow admin rights. They must click Yes on their screen.", false, 5000);
      }, { disabled: isWin ? "" : "Only needed on Windows" }),
      menuItem("Restart the remote computer", () => {
        if (!window.confirm("Restart the customer's computer now? Unsaved work on it will be lost.")) return;
        session.restartRemote();
        toast("Restart requested. Reconnect once the computer is back and MatixBridge is open.", false, 6000);
      })
    );
  }
  bMore.onclick = (e) => {
    e.stopPropagation();
    buildMenu();
    moreMenu.classList.toggle("hidden");
  };
  document.addEventListener("click", () => moreMenu.classList.add("hidden"));
  session.on("audioFormat", (rate, ch) => audio.configure(rate, ch));
  session.on("audio", (d) => {
    if (ctl.sound) audio.push(d);
  });
  session.on("notice", (kind, state, details) => {
    const B = M.BackNotification;
    if (kind === "block") {
      const ok = state === B.BlockInputState.BlkOnSucceeded || state === B.BlockInputState.BlkOffSucceeded;
      if (!ok) ctl.block = state === B.BlockInputState.BlkOffFailed;
      toast(
        state === B.BlockInputState.BlkOnSucceeded ? "The customer's mouse and keyboard are blocked"
          : state === B.BlockInputState.BlkOffSucceeded ? "The customer's mouse and keyboard work again"
          : "The remote computer could not change input blocking",
        !ok
      );
      return;
    }
    const P = B.PrivacyModeState;
    const on = state === P.PrvOnSucceeded;
    const off = state === P.PrvOffSucceeded || state === P.PrvOffByPeer || state === P.PrvOffUnknown;
    if (on) ctl.privacy = true;
    else if (off) ctl.privacy = false;
    else if (state !== P.PrvOnByOther) ctl.privacy = false;
    const msg =
      on ? "Privacy mode on: the customer's screen is black"
      : state === P.PrvOffByPeer ? "The customer turned privacy mode off"
      : off ? "Privacy mode off"
      : state === P.PrvNotSupported ? "Privacy mode is not supported on that computer"
      : state === P.PrvOnFailedDenied ? "The customer's settings do not allow privacy mode"
      : `Privacy mode failed${details ? `: ${details}` : ""}`;
    toast(msg, !on && !off);
  });
  session.on("elevation", (err) => {
    if (!err) toast("Admin rights granted. You can now control admin windows.");
    else toast(`Admin rights were not granted: ${err}`, true, 6000);
  });
  session.on("needsElevation", () => {
    if (warnedElevation || os !== "windows") return;
    warnedElevation = true;
    toast("The customer's active window needs admin rights. Use More ▾ › Request admin rights.", false, 8000);
  });

  // ---- recording ----
  let recorder: MediaRecorder | undefined;
  let recChunks: Blob[] = [];
  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }
  bRec.onclick = () => {
    if (recorder && recorder.state !== "inactive") {
      stopRecording();
      return;
    }
    const stream = canvas.captureStream(30);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
    recChunks = [];
    recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recorder.onstop = () => {
      bRec.classList.remove("on");
      session.send({ misc: { client_record_status: false } });
      const ext = (recorder?.mimeType || "").includes("mp4") ? "mp4" : "webm";
      const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      if (recChunks.length) saveBlob(new Blob(recChunks, { type: recorder?.mimeType }), `MatixBridge-${peerId}-${stamp}.${ext}`);
      recChunks = [];
    };
    recorder.start(1000);
    bRec.classList.add("on");
    session.send({ misc: { client_record_status: true } }); // the customer sees that the session is recorded
    toast("Recording started. Click Record again to stop and save.");
  };

  // ---- mouse ----
  function remotePos(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    const x = display.x + ((e.clientX - r.left) / r.width) * display.width;
    const y = display.y + ((e.clientY - r.top) / r.height) * display.height;
    return [Math.max(display.x, Math.min(display.x + display.width - 1, x)), Math.max(display.y, Math.min(display.y + display.height - 1, y))];
  }
  function modifiers(e: MouseEvent | KeyboardEvent): M.ControlKey[] {
    const m: M.ControlKey[] = [];
    if (e.altKey) m.push(M.ControlKey.Alt);
    if (e.ctrlKey) m.push(M.ControlKey.Control);
    if (e.shiftKey) m.push(M.ControlKey.Shift);
    if (e.metaKey) m.push(M.ControlKey.Meta);
    return m;
  }
  let lastMove = 0;
  canvas.addEventListener("mousemove", (e) => {
    if (!session.isLoggedIn) return;
    const now = performance.now();
    if (now - lastMove < 8) return; // ~120 Hz cap
    lastMove = now;
    const [x, y] = remotePos(e);
    session.mouse(MOUSE_MOVE, x, y);
  });
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    canvas.focus();
    if (!session.isLoggedIn) return;
    const [x, y] = remotePos(e);
    session.mouse(MOUSE_DOWN | ((BUTTONS[e.button] || 1) << 3), x, y, modifiers(e));
  });
  canvas.addEventListener("mouseup", (e) => {
    e.preventDefault();
    if (!session.isLoggedIn) return;
    const [x, y] = remotePos(e);
    session.mouse(MOUSE_UP | ((BUTTONS[e.button] || 1) << 3), x, y, modifiers(e));
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  let wheelX = 0, wheelY = 0;
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (!session.isLoggedIn) return;
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      wheelX += e.deltaX * scale;
      wheelY += e.deltaY * scale;
      const nx = Math.trunc(wheelX / 50), ny = Math.trunc(wheelY / 50);
      if (nx || ny) {
        wheelX -= nx * 50;
        wheelY -= ny * 50;
        session.mouse(MOUSE_WHEEL, -nx, -ny, modifiers(e));
      }
    },
    { passive: false }
  );

  // ---- keyboard ----
  const down = new Set<string>();
  let chain = Promise.resolve();
  function sendKey(code: string, isDown: boolean) {
    const chr = mapKey(code, os);
    if (chr === undefined) return false;
    if (code === "Pause" && os === "windows") {
      session.key({ down: isDown, control_key: M.ControlKey.Pause, mode: M.KeyboardMode.Legacy });
      return true;
    }
    session.key({ down: isDown, chr, mode: M.KeyboardMode.Map });
    return true;
  }
  function onKey(e: KeyboardEvent, isDown: boolean) {
    if (!session.isLoggedIn || document.activeElement !== canvas) return;
    if (e.code === "") return;
    e.preventDefault();
    e.stopPropagation();
    if (isDown) down.add(e.code);
    else down.delete(e.code);
    const code = e.code;
    const pasteShortcut = isDown && code === "KeyV" && (e.ctrlKey || e.metaKey);
    chain = chain.then(async () => {
      if (pasteShortcut) {
        // Sync our clipboard first so Ctrl+V on the remote pastes what the agent copied.
        try {
          const t = await navigator.clipboard.readText();
          if (t) session.sendClipboard(t);
        } catch {
          /* no permission: paste whatever the remote clipboard holds */
        }
      }
      if (!sendKey(code, isDown) && isDown && e.key.length === 1) session.typeText(e.key);
    });
  }
  function releaseKeys() {
    for (const code of down) sendKey(code, false);
    down.clear();
  }
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  document.addEventListener("keydown", kd, true);
  document.addEventListener("keyup", ku, true);
  canvas.addEventListener("blur", releaseKeys);
  window.addEventListener("blur", releaseKeys);
  const onUnload = () => session.close("Disconnected");
  window.addEventListener("beforeunload", onUnload);
  function teardown() {
    audio.close();
    document.removeEventListener("keydown", kd, true);
    document.removeEventListener("keyup", ku, true);
    window.removeEventListener("blur", releaseKeys);
    window.removeEventListener("beforeunload", onUnload);
    filesUi?.close();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  try {
    await session.connect(password || undefined);
  } catch (e) {
    if (!ended) {
      ended = true;
      teardown();
      connectScreen(cfg, e instanceof SessionError || e instanceof Error ? e.message : String(e));
    }
  }
}

// ---------- address book ----------
function addressBookPanel(pick: (id: string) => void, start: (id: string, filesOnly: boolean) => void): HTMLElement {
  const search = h("input", { class: "field", placeholder: "Search name, ID or computer…", type: "search" });
  const list = h("ul", { class: "book-list" });
  const count = h("span", { class: "book-count" });
  const addBtn = h("button", { class: "btn", type: "button", title: "Add a device without connecting" }, "+ Add");
  const menuBtn = h("button", { class: "btn", type: "button", title: "Export or import" }, "⋯");
  const menu = h("div", { class: "book-menu hidden" });
  const exp = h("button", { type: "button" }, "Export to file");
  const imp = h("button", { type: "button" }, "Import from file");
  const file = h("input", { type: "file", accept: ".json,application/json" }) as HTMLInputElement;
  file.style.display = "none";
  menu.append(exp, imp);
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  };
  document.addEventListener("click", () => menu.classList.add("hidden"));
  exp.onclick = () => {
    saveBlob(new Blob([book.exportJson()], { type: "application/json" }), `MatixBridge-devices-${new Date().toISOString().slice(0, 10)}.json`);
  };
  imp.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      const n = book.importJson(await f.text());
      toast(`Imported ${n} device${n === 1 ? "" : "s"}.`);
      render();
    } catch {
      toast("That file is not a MatixBridge device list.", true);
    }
  };
  addBtn.onclick = () => {
    const raw = window.prompt("Device ID:");
    const did = (raw || "").replace(/\D/g, "");
    if (did.length < 6) return;
    const name = window.prompt("Name (customer or company):", "") || "";
    book.upsert(did, { name: name.trim() });
    render();
  };
  search.addEventListener("input", () => render());

  function card(d: Device) {
    const letter = (displayName(d).trim()[0] || "#").toUpperCase();
    const hue = [...d.id].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
    const av = h("span", { class: "book-av" }, letter);
    av.style.background = `hsl(${hue} 55% 38%)`;
    const nameEl = h("b", { class: "book-name" }, displayName(d));
    const meta = [d.host && d.name ? d.host : "", osLabel(d.platform), d.last ? timeAgo(d.last) : "not connected yet"].filter(Boolean).join(" · ");
    const star = h("button", { class: "icon-btn" + (d.fav ? " on" : ""), type: "button", title: d.fav ? "Unpin" : "Pin to top" }, d.fav ? "★" : "☆");
    const edit = h("button", { class: "icon-btn", type: "button", title: "Rename" }, "✎");
    const del = h("button", { class: "icon-btn", type: "button", title: "Remove" }, "🗑");
    const files = h("button", { class: "icon-btn", type: "button", title: "File transfer" }, "📁");
    const connect = h("button", { class: "btn primary", type: "button" }, "Connect");
    star.onclick = (e) => {
      e.stopPropagation();
      book.upsert(d.id, { fav: !d.fav });
      render();
    };
    edit.onclick = (e) => {
      e.stopPropagation();
      const name = window.prompt("Name for this device:", d.name);
      if (name === null) return;
      book.upsert(d.id, { name: name.trim() });
      render();
    };
    del.onclick = (e) => {
      e.stopPropagation();
      if (window.confirm(`Remove ${displayName(d)} (${formatId(d.id)}) from your devices?`)) {
        book.remove(d.id);
        render();
      }
    };
    files.onclick = (e) => {
      e.stopPropagation();
      start(d.id, true);
    };
    connect.onclick = (e) => {
      e.stopPropagation();
      start(d.id, false);
    };
    const li = h(
      "li",
      { class: "book-item", title: "Click to fill the ID" },
      av,
      h("div", { class: "book-info" }, nameEl, h("span", { class: "book-id" }, formatId(d.id)), h("span", { class: "book-meta" }, meta)),
      h("div", { class: "book-actions" }, star, edit, files, del, connect)
    );
    li.onclick = () => pick(d.id);
    return li;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const qd = q.replace(/\s/g, "");
    const all = book.all();
    const shown = all.filter((d) => !q || displayName(d).toLowerCase().includes(q) || d.host.toLowerCase().includes(q) || d.user.toLowerCase().includes(q) || (qd && d.id.includes(qd)));
    count.textContent = all.length ? String(all.length) : "";
    list.replaceChildren(...shown.map(card));
    if (!all.length) list.append(h("li", { class: "book-empty" }, "Devices you connect to appear here, so you can reconnect in one click. Click the device name during a session to label it."));
    else if (!shown.length) list.append(h("li", { class: "book-empty" }, "No device matches your search."));
  }
  render();
  return h(
    "section",
    { class: "card book" },
    h("div", { class: "book-head" }, h("h2", {}, "Customer devices ", count), h("div", { class: "book-tools" }, addBtn, h("div", { class: "book-menu-wrap" }, menuBtn, menu))),
    search,
    list,
    file,
    h("div", { class: "hint" }, "Saved in this browser only. Use ⋯ › Export to move the list to another computer.")
  );
}

// ---------- files panel (used inside a session and stand-alone) ----------
class FilesPanel {
  el: HTMLElement;
  private fs: FileSession | undefined;
  private connecting: Promise<void> | undefined;
  private list = h("ul");
  private pathInput = h("input", { class: "field", spellcheck: "false" });
  private transfers = h("div", { class: "transfers" });
  private status = h("div", { class: "hint", style: "padding:0 12px" });
  private cwd = "";

  constructor(private cfg: ServerConfig, private peerId: string, private password: string, private agentName: string, onClose: () => void) {
    const up = h("button", { class: "btn", type: "button", title: "Parent folder" }, "↑");
    const go = h("button", { class: "btn", type: "button" }, "Go");
    const x = h("button", { class: "x", type: "button", title: "Close" }, "×");
    x.onclick = onClose;
    const pick = h("input", { type: "file", multiple: "" }) as HTMLInputElement;
    pick.style.display = "none";
    const drop = h("div", { class: "drop" }, "Drop files here or ", h("a", { href: "#" }, "choose files"), " to upload to this folder");
    drop.querySelector("a")!.addEventListener("click", (e) => {
      e.preventDefault();
      pick.click();
    });
    pick.onchange = () => {
      if (pick.files?.length) void this.upload([...pick.files]);
      pick.value = "";
    };
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) void this.upload(files);
    });
    up.onclick = () => this.fs && void this.load(this.fs.parent(this.cwd));
    go.onclick = () => void this.load(this.pathInput.value);
    this.pathInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void this.load(this.pathInput.value);
    });
    this.el = h("div", { class: "files" }, h("header", {}, "Remote files", x), h("div", { class: "path" }, up, this.pathInput, go), this.status, this.list, drop, pick, this.transfers);
  }

  async open() {
    if (this.fs) return;
    this.connecting ||= (async () => {
      this.status.textContent = "Opening file transfer…";
      const fs = new FileSession(this.peerId, this.cfg, this.agentName);
      fs.session.on("password", async (wrong) => {
        const p = window.prompt(wrong ? "Wrong password. Password:" : "Password for file transfer:");
        if (p === null) fs.close();
        else fs.session.login(p);
      });
      fs.session.on("closed", (r) => {
        this.status.textContent = `File transfer closed: ${r}`;
        this.fs = undefined;
        this.connecting = undefined;
      });
      await fs.connect(this.password || undefined);
      const pi = fs.session.peerInfo;
      book.record(this.peerId, { host: pi?.hostname, user: pi?.username, platform: pi?.platform });
      this.fs = fs;
      await this.load("");
    })().catch((e) => {
      this.status.textContent = e instanceof Error ? e.message : String(e);
      this.connecting = undefined;
    });
    await this.connecting;
  }

  async load(path: string) {
    if (!this.fs) return;
    this.status.textContent = "Loading…";
    try {
      const dir: RemoteDir = await this.fs.readDir(path);
      this.cwd = dir.path;
      this.pathInput.value = dir.path;
      this.status.textContent = "";
      const items = dir.entries.filter((e) => !e.hidden).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
      this.list.replaceChildren(...items.map((e) => this.row(e)));
      if (!items.length) this.list.append(h("li", {}, "", h("span", { class: "meta" }, "Empty folder"), ""));
    } catch (e) {
      this.status.textContent = e instanceof Error ? e.message : String(e);
    }
  }

  private row(e: RemoteEntry) {
    const li = h("li", { class: e.isDir ? "dir" : "" }, e.isDir ? "📁" : "📄", h("span", { class: "name", title: e.name }, e.name));
    if (e.isDir) {
      li.querySelector(".name")!.addEventListener("click", () => void this.load(this.fs!.join(this.cwd, e.name)));
      li.append(h("span", { class: "meta" }, ""));
    } else {
      const dl = h("button", { class: "btn", type: "button", title: `Download (${fmtSize(e.size)})` }, "⬇");
      dl.onclick = () => void this.download(e);
      li.append(h("span", { class: "meta" }, fmtSize(e.size), " ", dl));
    }
    return li;
  }

  private progressRow(name: string) {
    const bar = h("i");
    const label = h("span", {}, name);
    const row = h("div", { class: "transfer" }, label, h("div", { class: "bar" }, bar));
    this.transfers.append(row);
    return {
      set: (done: number, total: number) => {
        bar.style.width = `${total ? Math.min(100, (done / total) * 100) : 100}%`;
        label.textContent = `${name} · ${fmtSize(done)} / ${fmtSize(total)}`;
      },
      end: (msg: string) => {
        label.textContent = `${name} · ${msg}`;
        setTimeout(() => row.remove(), 4000);
      },
    };
  }

  private async download(e: RemoteEntry) {
    if (!this.fs) return;
    const p = this.progressRow(e.name);
    try {
      const blob = await this.fs.download(this.fs.join(this.cwd, e.name), e.size, (pr) => p.set(pr.done, pr.total));
      saveBlob(blob, e.name);
      p.end("done");
    } catch (err) {
      p.end(err instanceof Error ? err.message : "failed");
    }
  }

  private async upload(files: File[]) {
    if (!this.fs) return toast("File transfer is not connected yet.", true);
    const rows = new Map(files.map((f) => [f.name, this.progressRow(f.name)]));
    try {
      await this.fs.upload(this.cwd, files, (pr) => rows.get(pr.name)?.set(pr.done, pr.total));
      rows.forEach((r) => r.end("uploaded"));
      setTimeout(() => void this.load(this.cwd), 700);
    } catch (err) {
      rows.forEach((r) => r.end(err instanceof Error ? err.message : "failed"));
    }
  }

  close() {
    this.fs?.close();
  }
}

async function filesScreen(cfg: ServerConfig, peerId: string, password: string, agentName: string) {
  app.replaceChildren();
  const panel = new FilesPanel(cfg, peerId, password, agentName, () => {
    panel.close();
    connectScreen(cfg);
  });
  const wrap = h("div", { class: "connect" });
  const card = h("div", { class: "card", style: "width:min(720px,100%);height:min(80vh,720px);padding:0;display:flex;overflow:hidden" }, panel.el);
  wrap.append(card);
  app.append(wrap);
  await panel.open();
}

// ---------- boot ----------
loadConfig()
  .then((cfg) => connectScreen(cfg))
  .catch((e) => {
    app.replaceChildren(h("div", { class: "connect" }, h("div", { class: "card" }, h("h2", {}, "MatixBridge"), h("p", { class: "error" }, String(e instanceof Error ? e.message : e)))));
  });
