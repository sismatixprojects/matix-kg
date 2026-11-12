// Crypto primitives matching RustDesk's hbb_common (libsodium: sign, box, secretbox, generichash).
import _sodium from "libsodium-wrappers";
import { sha256 as nobleSha256 } from "@noble/hashes/sha256";

let s: typeof _sodium | undefined;

export async function ready(): Promise<void> {
  if (s) return;
  await _sodium.ready;
  s = _sodium;
}

function lib(): typeof _sodium {
  if (!s) throw new Error("crypto not initialised; call ready() first");
  return s;
}

export function fromBase64(text: string): Uint8Array {
  return lib().from_base64(text.trim(), lib().base64_variants.ORIGINAL);
}

/** Verifies an ed25519 signed message and returns its payload; throws if the signature is bad. */
export function signOpen(signed: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return lib().crypto_sign_open(signed, publicKey);
}

export function sha256(...parts: (string | Uint8Array)[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
  return nobleSha256(concat(chunks));
}

export function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

/** Nonce layout from hbb_common tcp.rs: the u64 sequence number, little-endian, then zeros. */
function nonce(seq: number): Uint8Array {
  const n = new Uint8Array(24);
  let v = seq;
  for (let i = 0; i < 8 && v > 0; i++) {
    n[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return n;
}

/** Newest key exchange version we speak (hbb_common KX_VERSION_LATEST). */
export const KX_VERSION_LATEST = 1;
const KX_SPLIT_CONTEXT = new TextEncoder().encode("rdkx-spl");
const KX_SPLIT_INITIATOR = 1;
const KX_SPLIT_RESPONDER = 2;

export interface KeyExchange {
  /** Our ephemeral box public key, sent as PublicKey.asymmetric_value. */
  publicKey: Uint8Array;
  /** The session key sealed to the peer, sent as PublicKey.symmetric_value. */
  sealed: Uint8Array;
  /** The version we picked, sent as PublicKey.kx_version. */
  picked: number;
  cipher: Cipher;
}

/**
 * Runs the controller (initiator) side of the RustDesk key exchange against the peer's
 * box public key and its advertised kx_version.
 */
export function keyExchange(theirBoxPk: Uint8Array, advertised: number): KeyExchange {
  const l = lib();
  if (theirBoxPk.length !== l.crypto_box_PUBLICKEYBYTES) {
    throw new Error("Handshake failed: invalid box key length from peer");
  }
  const pair = l.crypto_box_keypair();
  const key = l.crypto_secretbox_keygen();
  const sealed = l.crypto_box_easy(key, new Uint8Array(24), theirBoxPk, pair.privateKey);
  const picked = Math.min(advertised, KX_VERSION_LATEST);
  let cipher: Cipher;
  if (picked === 0) {
    cipher = new Cipher(key, key);
  } else {
    const derive = (direction: number) =>
      l.crypto_generichash(
        l.crypto_secretbox_KEYBYTES,
        concat([
          KX_SPLIT_CONTEXT,
          new Uint8Array([direction]),
          u32le(advertised),
          u32le(picked),
          pair.publicKey, // initiator: the side that sent the sealed key (us)
          theirBoxPk, // responder
        ]),
        key
      );
    cipher = new Cipher(derive(KX_SPLIT_INITIATOR), derive(KX_SPLIT_RESPONDER));
  }
  return { publicKey: pair.publicKey, sealed, picked, cipher };
}

export class Cipher {
  private sendSeq = 0;
  private recvSeq = 0;
  constructor(private sendKey: Uint8Array, private recvKey: Uint8Array) {}

  encrypt(data: Uint8Array): Uint8Array {
    this.sendSeq += 1;
    return lib().crypto_secretbox_easy(data, nonce(this.sendSeq), this.sendKey);
  }

  decrypt(data: Uint8Array): Uint8Array {
    // hbb_common passes frames of 0/1 bytes through untouched.
    if (data.length <= 1) return data;
    this.recvSeq += 1;
    return lib().crypto_secretbox_open_easy(data, nonce(this.recvSeq), this.recvKey);
  }
}
