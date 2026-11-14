// Address book: customer devices this agent has connected to, kept in this browser.
// No passwords are stored; reconnecting asks the customer to accept (or for the password) again.
import { t } from "../i18n";

export interface Device {
  id: string;
  name: string; // the agent's label, e.g. the customer or company name
  host: string;
  user: string;
  platform: string;
  fav: boolean;
  last: number; // ms since epoch of the last successful connection
  count: number;
}

const KEY = "matixbridge.book";

function load(): Device[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((d) => d && typeof d.id === "string").map(normalize) : [];
  } catch {
    return [];
  }
}

function save(list: Device[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: the book just won't persist */
  }
}

function normalize(d: Partial<Device> & { id: string }): Device {
  return {
    id: String(d.id).replace(/\D/g, ""),
    name: String(d.name || "").slice(0, 80),
    host: String(d.host || ""),
    user: String(d.user || ""),
    platform: String(d.platform || ""),
    fav: !!d.fav,
    last: Number(d.last) || 0,
    count: Number(d.count) || 0,
  };
}

export const book = {
  all(): Device[] {
    return load().sort((a, b) => Number(b.fav) - Number(a.fav) || b.last - a.last);
  },
  get(id: string): Device | undefined {
    return load().find((d) => d.id === id);
  },
  /** Called when a session to `id` logs in: adds the device or refreshes what we know about it. */
  record(id: string, info: { host?: string; user?: string; platform?: string }) {
    const list = load();
    let d = list.find((x) => x.id === id);
    if (!d) {
      d = normalize({ id });
      list.push(d);
    }
    if (info.host) d.host = info.host;
    if (info.user) d.user = info.user;
    if (info.platform) d.platform = info.platform;
    d.last = Date.now();
    d.count += 1;
    save(list);
  },
  upsert(id: string, patch: Partial<Device>) {
    const list = load();
    let d = list.find((x) => x.id === id);
    if (!d) {
      d = normalize({ id });
      list.push(d);
    }
    Object.assign(d, normalize({ ...d, ...patch, id }));
    save(list);
  },
  remove(id: string) {
    save(load().filter((d) => d.id !== id));
  },
  exportJson(): string {
    return JSON.stringify({ app: "MatixBridge", version: 1, devices: load() }, null, 2);
  },
  /** Merges an exported file; returns how many devices were added or updated. */
  importJson(text: string): number {
    const data = JSON.parse(text);
    const incoming: Device[] = (Array.isArray(data) ? data : data?.devices || []).filter((d: Device) => d && d.id).map(normalize);
    const list = load();
    for (const d of incoming) {
      if (d.id.length < 6) continue;
      const cur = list.find((x) => x.id === d.id);
      if (!cur) list.push(d);
      else Object.assign(cur, { ...d, name: d.name || cur.name, last: Math.max(cur.last, d.last), count: Math.max(cur.count, d.count), fav: cur.fav || d.fav });
    }
    save(list);
    return incoming.length;
  },
};

export function displayName(d: Device): string {
  return d.name || d.host || d.id;
}

export function timeAgo(ms: number): string {
  if (!ms) return t("never");
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return t("just now");
  if (s < 3600) return t("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.floor(s / 3600) });
  const days = Math.floor(s / 86400);
  if (days < 30) return days === 1 ? t("1 day ago") : t("{n} days ago", { n: days });
  return new Date(ms).toLocaleDateString();
}

/** Short OS label used on the cards. */
export function osLabel(platform: string): string {
  const p = platform.toLowerCase();
  if (p.startsWith("win")) return "Windows";
  if (p.startsWith("mac")) return "macOS";
  if (p.startsWith("android")) return "Android";
  if (p.startsWith("linux")) return "Linux";
  return platform;
}
