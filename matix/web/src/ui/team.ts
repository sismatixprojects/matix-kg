// Team sign-in and shared address book, backed by agents.matix.one (/api/v1/matixbridge).
// Active when config.json has "agentsUrl": then signing in is required, and the token also goes to
// the server's sign-in gate (cookie on /ws) without which the ID and relay servers refuse the
// browser. Without "agentsUrl" the web client works as before, with the per-browser address book.
//
// Sign-in: the agent is sent to <agentsUrl>/bridge-signin, signs in there if needed, and comes back
// with a single-use code in the URL fragment, which is exchanged here for a MatixBridge-only token
// (it cannot call the rest of the agents API).

import type { Device } from "./addressbook";

export interface TeamAgent {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface Stored {
  api: string;
  token: string;
  exp: number;
  agent: TeamAgent;
  org: { id: number; name: string };
}

export interface TeamDevice extends Device {
  client_name: string | null;
  last_agent: string | null;
  notes: string;
}

const KEY = "matixbridge.team";

let base = "";
let state: Stored | null = null;
const listeners = new Set<() => void>();

function load(): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null") as Stored | null;
    if (s && s.api === base && s.token && s.exp > Date.now() + 60_000) return s;
  } catch {
    /* ignore */
  }
  return null;
}

// The browser cannot put headers on a WebSocket, so the gate in front of /ws/id and /ws/relay
// reads the token from this cookie. SameSite=Strict: other sites cannot open the sockets as the agent.
const GATE_COOKIE = "mb_t";
function gateCookie() {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const age = state ? Math.max(0, Math.floor((state.exp - Date.now()) / 1000)) : 0;
  document.cookie = `${GATE_COOKIE}=${state ? encodeURIComponent(state.token) : ""}; Path=/ws; Max-Age=${age}; SameSite=Strict${secure}`;
}

function persist() {
  gateCookie();
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: stays signed in for this page only */
  }
  listeners.forEach((f) => f());
}

export class TeamAuthError extends Error {}

async function call<T>(method: string, path: string, body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  if (!state) throw new TeamAuthError("Not signed in");
  const r = await fetch(`${base}/api/v1/matixbridge${path}`, {
    method,
    headers: { Authorization: `Bearer ${state.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    keepalive: opts.keepalive,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) {
    state = null;
    persist();
    throw new TeamAuthError(j.message || "Your sign-in has expired. Please sign in again.");
  }
  if (!r.ok || j.success === false) throw new Error(j.message || `Request failed (${r.status})`);
  return j as T;
}

function toDevice(d: Record<string, unknown>): TeamDevice {
  return {
    id: String(d.id),
    name: String(d.name || ""),
    host: String(d.host || ""),
    user: String(d.user || ""),
    platform: String(d.platform || ""),
    fav: false,
    last: Number(d.last) || 0,
    count: Number(d.count) || 0,
    client_name: (d.client_name as string) || null,
    last_agent: (d.last_agent as string) || null,
    notes: String(d.notes || ""),
  };
}

export const team = {
  /** Called once at boot with config.json's agentsUrl (may be empty). */
  init(agentsUrl: string | undefined) {
    base = (agentsUrl || "").replace(/\/+$/, "");
    state = base ? load() : null;
    if (base) gateCookie();
  },
  get enabled() {
    return !!base;
  },
  get signedIn() {
    return !!state;
  },
  get agent(): TeamAgent | null {
    return state?.agent || null;
  },
  get org() {
    return state?.org || null;
  },
  get canDelete() {
    return state?.agent.role === "admin" || state?.agent.role === "supervisor";
  },
  onChange(f: () => void) {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  /** Where "Sign in" goes. Sign-in only: agents.matix.one passes nothing back but the code. */
  signInUrl() {
    return `${base}/bridge-signin`;
  },
  async exchange(code: string) {
    const r = await fetch(`${base}/api/v1/matixbridge/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) throw new Error(j.message || "Sign-in failed");
    state = { api: base, token: j.token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, agent: j.agent, org: j.org };
    persist();
  },
  /** Asks agents.matix.one whether the sign-in still holds; a refusal signs out (TeamAuthError). */
  async check() {
    await call("GET", "/me");
  },
  signOut() {
    state = null;
    persist();
  },
  async devices(): Promise<TeamDevice[]> {
    const j = await call<{ devices: Record<string, unknown>[] }>("GET", "/devices");
    return j.devices.map(toDevice);
  },
  async save(id: string, patch: { name?: string; notes?: string }): Promise<TeamDevice> {
    const j = await call<{ device: Record<string, unknown> }>("PUT", `/devices/${encodeURIComponent(id)}`, patch);
    return toDevice(j.device);
  },
  async remove(id: string) {
    await call("DELETE", `/devices/${encodeURIComponent(id)}`);
  },
  /** Logs a session that just logged in; returns its id for sessionEnd. */
  async sessionStart(info: { device_id: string; ticket_id?: string; kind: "control" | "files"; host?: string; user?: string; platform?: string }): Promise<number> {
    const j = await call<{ session_id: number }>("POST", "/sessions", info);
    return j.session_id;
  },
  sessionEnd(sessionId: number) {
    // keepalive: still delivered when the tab is closing.
    return call("POST", `/sessions/${sessionId}/end`, undefined, { keepalive: true }).catch(() => {});
  },
};
