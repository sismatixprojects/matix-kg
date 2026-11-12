// Physical-key ("map" mode) codes, as RustDesk's map_keyboard_mode sends them: the key code native
// to the *remote* OS. Windows: set-1 scancode (0xE0xx for extended keys). macOS: virtual key code.
// Linux: X11 keycode (evdev + 8). Indexed by KeyboardEvent.code.
type Row = [win: number, mac: number, evdev: number];

const T: Record<string, Row> = {
  Escape: [0x01, 53, 1],
  Digit1: [0x02, 18, 2], Digit2: [0x03, 19, 3], Digit3: [0x04, 20, 4], Digit4: [0x05, 21, 5],
  Digit5: [0x06, 23, 6], Digit6: [0x07, 22, 7], Digit7: [0x08, 26, 8], Digit8: [0x09, 28, 9],
  Digit9: [0x0a, 25, 10], Digit0: [0x0b, 29, 11],
  Minus: [0x0c, 27, 12], Equal: [0x0d, 24, 13], Backspace: [0x0e, 51, 14], Tab: [0x0f, 48, 15],
  KeyQ: [0x10, 12, 16], KeyW: [0x11, 13, 17], KeyE: [0x12, 14, 18], KeyR: [0x13, 15, 19],
  KeyT: [0x14, 17, 20], KeyY: [0x15, 16, 21], KeyU: [0x16, 32, 22], KeyI: [0x17, 34, 23],
  KeyO: [0x18, 31, 24], KeyP: [0x19, 35, 25],
  BracketLeft: [0x1a, 33, 26], BracketRight: [0x1b, 30, 27], Enter: [0x1c, 36, 28],
  ControlLeft: [0x1d, 59, 29],
  KeyA: [0x1e, 0, 30], KeyS: [0x1f, 1, 31], KeyD: [0x20, 2, 32], KeyF: [0x21, 3, 33],
  KeyG: [0x22, 5, 34], KeyH: [0x23, 4, 35], KeyJ: [0x24, 38, 36], KeyK: [0x25, 40, 37],
  KeyL: [0x26, 37, 38],
  Semicolon: [0x27, 41, 39], Quote: [0x28, 39, 40], Backquote: [0x29, 50, 41],
  ShiftLeft: [0x2a, 56, 42], Backslash: [0x2b, 42, 43],
  KeyZ: [0x2c, 6, 44], KeyX: [0x2d, 7, 45], KeyC: [0x2e, 8, 46], KeyV: [0x2f, 9, 47],
  KeyB: [0x30, 11, 48], KeyN: [0x31, 45, 49], KeyM: [0x32, 46, 50],
  Comma: [0x33, 43, 51], Period: [0x34, 47, 52], Slash: [0x35, 44, 53],
  ShiftRight: [0x36, 60, 54], NumpadMultiply: [0x37, 67, 55], AltLeft: [0x38, 58, 56],
  Space: [0x39, 49, 57], CapsLock: [0x3a, 57, 58],
  F1: [0x3b, 122, 59], F2: [0x3c, 120, 60], F3: [0x3d, 99, 61], F4: [0x3e, 118, 62],
  F5: [0x3f, 96, 63], F6: [0x40, 97, 64], F7: [0x41, 98, 65], F8: [0x42, 100, 66],
  F9: [0x43, 101, 67], F10: [0x44, 109, 68],
  NumLock: [0x45, 71, 69], ScrollLock: [0x46, 107, 70],
  Numpad7: [0x47, 89, 71], Numpad8: [0x48, 91, 72], Numpad9: [0x49, 92, 73],
  NumpadSubtract: [0x4a, 78, 74], Numpad4: [0x4b, 86, 75], Numpad5: [0x4c, 87, 76],
  Numpad6: [0x4d, 88, 77], NumpadAdd: [0x4e, 69, 78], Numpad1: [0x4f, 83, 79],
  Numpad2: [0x50, 84, 80], Numpad3: [0x51, 85, 81], Numpad0: [0x52, 82, 82],
  NumpadDecimal: [0x53, 65, 83],
  IntlBackslash: [0x56, 10, 86], F11: [0x57, 103, 87], F12: [0x58, 111, 88],
  NumpadEqual: [0x59, 81, 117], IntlRo: [0x73, 94, 89], IntlYen: [0x7d, 93, 124],
  NumpadEnter: [0xe01c, 76, 96], ControlRight: [0xe01d, 62, 97], NumpadDivide: [0xe035, 75, 98],
  PrintScreen: [0xe037, 105, 99], AltRight: [0xe038, 61, 100],
  Home: [0xe047, 115, 102], ArrowUp: [0xe048, 126, 103], PageUp: [0xe049, 116, 104],
  ArrowLeft: [0xe04b, 123, 105], ArrowRight: [0xe04d, 124, 106], End: [0xe04f, 119, 107],
  ArrowDown: [0xe050, 125, 108], PageDown: [0xe051, 121, 109], Insert: [0xe052, 114, 110],
  Delete: [0xe053, 117, 111],
  MetaLeft: [0xe05b, 55, 125], MetaRight: [0xe05c, 54, 126], ContextMenu: [0xe05d, 110, 127],
};

export type RemoteOs = "windows" | "macos" | "linux" | "android";

export function remoteOs(platform: string | undefined): RemoteOs {
  const p = (platform || "").toLowerCase();
  if (p.startsWith("win")) return "windows";
  if (p.startsWith("mac")) return "macos";
  if (p.startsWith("android")) return "android";
  return "linux";
}

/** Returns the remote key code for a physical key, or undefined if it has no mapping. */
export function mapKey(code: string, os: RemoteOs): number | undefined {
  const row = T[code];
  if (!row) return undefined;
  switch (os) {
    case "windows":
      return row[0];
    case "macos":
      return row[1];
    case "linux":
      return row[2] + 8;
    default:
      return undefined;
  }
}
