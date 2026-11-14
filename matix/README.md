# MatixBridge

> The tool was first called "Matix KG". Infrastructure that is already deployed keeps that name:
> the old address `kg.matix.one` (now a redirect), the cPanel account `kgmatix`, the systemd units `matix-kg-hbbs`/`matix-kg-hbbr`,
> `/var/lib/matix-kg`, the repository variables `MATIX_KG_*` and the `matix-kg` build input.

Remote support for Matix: a support agent controls a customer's PC from the browser.
It is built on RustDesk (AGPL-3.0). The fork adds three things and leaves upstream code alone:

| Path | What it is |
| --- | --- |
| `matix/web` | **Web client**: our own TypeScript controller that runs in the agent's browser |
| `matix/brand` | Name, icons and the server/key baked into the **customer app** (native RustDesk builds) |
| `matix/server` | Install kit for the **ID/relay server** (RustDesk `hbbs`/`hbbr`) and its TLS proxy |

```
agent's browser ──wss──► agents.matix.one/bridge/ws (Cloudflare ► Apache ► sign-in gate) ──► hbbs :21118 / hbbr :21119
                                                                          ▲            ▲
customer's MatixBridge app ──tcp/udp 21115-21117──► kg-id.matix.one (DNS only) ┘            │
                        └──────────────── relayed session (always, for web) ─────────────┘
```

A browser can only be the controlling side. Customers run the MatixBridge app; agents use
`https://agents.matix.one/bridge/` (the customer app is receive-only).

## Web client (`matix/web`)

- `src/core/session.ts`: the protocol. It covers rendezvous over WebSocket, the relay,
  and the key exchange (`kx_version` 0 and 1).
  - The handshake **fails closed**: if the server's signature on the peer key does not
    verify, it refuses to connect. It never falls back to an unencrypted session.
  - Login works with a password, or with no password, in which case the customer clicks Accept.
- `src/core/files.ts`: file transfer, over a second file-transfer connection as the native client does.
- `src/ui/video.ts`: WebCodecs decoding of VP9/VP8/AV1/H.264.
- `src/ui/keymap.ts`: physical-key ("map" mode) codes for Windows, macOS and Linux peers.
- `src/main.ts`: the UI.
  - Display picker, quality, Ctrl+Alt+Del, lock and refresh.
  - "Type text" and clipboard sync.
  - Chat and the file panel.
  - Full screen with keyboard lock.
  - Session recording to a local `.webm`. The customer is told that recording is on.

```bash
cd matix/web
npm ci
npm run dev        # http://localhost:5173/?idServer=ws://HOST:21118&relayServer=ws://HOST:21119&key=KEY
npm run build      # dist/ — copy to the server with a config.json next to index.html
npm run smoke      # Node protocol test against a real peer (env: ID, PASSWORD, ID_SERVER, RELAY_SERVER, KEY)
npx tsx scripts/files-smoke.ts   # upload + list + download + compare
```

`config.json` (served next to `index.html`):

```json
{ "idServer": "wss://agents.matix.one/bridge/ws/id", "relayServer": "wss://agents.matix.one/bridge/ws/relay", "key": "<id_ed25519.pub>",
  "agentsUrl": "https://agents.matix.one" }
```

`agentsUrl` is optional. When it is set, agents **must sign in with their agents.matix.one account**
before they can connect. Signing in gives them the team's shared device list and logs each session,
as internal notes on the helpdesk ticket when the session was opened from one. Without it, the
client keeps the per-browser device list and needs no sign-in (as in the Windows CI job).

How sign-in works:
- MatixBridge sends the agent to `<agentsUrl>/bridge-signin`.
- agents.matix.one mints a single-use 120-second code and sends the agent back with
  `#code=…` in the URL fragment.
- The web client trades the code for a token that works only on `/api/v1/matixbridge`.

The ticket page's **🖥️ Remote control** button opens `#code=…&id=<device>&ticket=<id>` the same way.
The backend lives in the agents.matix.one repo: `backend/src/routes/matixbridge.routes.js` and
`matixbridge_migration.sql`. Add `agentsUrl` to the production `config.json` only once that is
deployed.

CI (`.github/workflows/matix-web-e2e.yml`) starts an unmodified RustDesk peer on a virtual X
display behind our own `hbbs`/`hbbr`, then runs:

- the Node smoke test;
- the file-transfer test;
- a headless-Chromium test that checks video reaches the canvas and that typed keys change the remote screen.
  On Linux it then opens a ticket launch (`#code=…&id=…&ticket=10`) against a stand-in for the
  agents API and checks that the session start and end are logged.

**Local testing pitfall:** bind `hbbs`/`hbbr` to a LAN IP, never `127.0.0.1`. `hbbr` treats
TCP connections from loopback as its admin console, so a local peer's relay connection gets reset.

## Agents only

Since v0.5 only signed-in Matix staff can start a session. Three parts, the first two being the lock:

1. **Patched hbbs** (`matix/server/hbbs/agents-only.patch` on rustdesk-server 1.1.16): hbbs refuses
   `PunchHoleRequest` and `RequestRelay` unless they arrive on its WebSocket port (21118). Native
   controllers use TCP 21116, so no app can start a session, whatever its key. That includes v0.4,
   stock RustDesk, or anything else. They get "Remote control is only available from agents.matix.one (MatixBridge)".
   Customer apps are unaffected: they only answer on 21116 (`RelayResponse`, …) and send
   `RequestRelay` to hbbr. The key stays the same, so installed apps keep working.
   CI (`matix-web-e2e.yml`, job `server`) builds it static for x86_64 musl, and
   `scripts/native-refused.ts` checks the refusal against a real peer.
2. **Sign-in gate** (`matix/server/gate/gate.mjs`, systemd `matixbridge-gate`, 127.0.0.1:21120)
   sits in front of 21118/21119. Apache and nginx proxy `/ws/id` and `/ws/relay` to it.
   - The gate needs the `mb_t` cookie, which the web client sets on `/ws` after sign-in, and an
     allowed `Origin`.
   - It checks the cookie against agents.matix.one `GET /api/v1/matixbridge/me`, with a 60 s cache.
     That check also refuses disabled agents and suspended organisations.
   - It fails closed if agents.matix.one is down.
   - It checks only when a socket opens: disabling an agent stops new sessions, not one already open.
   - Tests: `node --test matix/server/gate/gate.test.mjs`; the Linux e2e runs the browser through it.
3. **Receive-only customer app** (`matix/brand/apply.sh`, upstream's `conn-type=incoming`): the app
   shows its ID and password and can be controlled, but has no "connect to" box.

Known limit: anyone with a shell on the server can reach 127.0.0.1:21118 directly, which bypasses
the gate. 21118/21119 must stay closed in the firewall.

## Production (since 2026-11-12)

- **Web client:** https://agents.matix.one/bridge/ (since 2026-11-13; it was bridge.matix.one/web/ before).
  - The files are in `/opt/matix-kg/web`, outside the portal's public_html, so portal deploys never touch them.
  - Apache serves them, and proxies `/bridge/ws/*` to the gate, through
    `matix/server/apache-agents.conf` (agentsmatix userdata include `matixbridge.conf`).
  - `bridge.matix.one` and `kg.matix.one` (cPanel account kgmatix) only redirect there
    (`matix/server/apache.conf`), and proxy no WebSockets.
  - Same origin as the portal: no CORS, and signing out of the portal signs out of MatixBridge too.
- **ID/relay server:** systemd units `matix-kg-hbbs` and `matix-kg-hbbr` on 72.52.136.5 (US). Data is in
  `/var/lib/matix-kg`, and the public key is `0sY5K0X3HCRHqb4wfySRcEk1zJTzUmeeW5n3UUMLL9c=`.
  - CSF opens TCP 21115:21117 and UDP 21116. Ports 21118/21119 are reachable only through Apache.
  - The customer app reaches the server by IP. Moving hosts means rebuilding the apps, or using a DNS-only name.
- **Agents-only parts:**
  - Patched hbbs: `/opt/matix-kg/bin/hbbs`. The release binary is kept as `hbbs.release-1.1.16`.
  - Gate: `/opt/matix-kg/gate/gate.mjs` plus `/etc/systemd/system/matixbridge-gate.service`.
  - Deploy order: gate, then the web client at /bridge/ and its Apache include, then the
    bridge.matix.one redirect, then hbbs.
- **Update the web client:** `npm run build`, then put the production `config.json` into `dist/`, then
  `rsync -a --delete dist/ root@72.52.136.5:/opt/matix-kg/web/` (port 522).
- **Forced update:** each app from v0.7 knows its build (`matixbridge-v0.7` → 7, `v1.2` → 102; set by
  `apply.sh` from the release tag). `"minAppBuild"` in the production `/opt/matix-kg/web/config.json`
  is the oldest build allowed. An older app shows only a «يجب تحديث / Update now» screen, which opens
  the download page. The agents' web client refuses older apps, and so does file transfer. Apps
  before v0.7 report no build, so they count as 0. To force a release: publish it on the download page
  first, then raise `minAppBuild` to its build. No rebuild is needed.

## Server (`matix/server`)

1. **Host.** Any small Linux VM works. Pick one close to the customers, since web sessions
   are always relayed (a Gulf region suits Egypt).
2. **DNS (Cloudflare).**
   - The web host (here agents.matix.one): proxied (orange). Carries the web client and its WebSockets.
   - `kg-id.matix.one`: **DNS only (grey)**. Cloudflare does not carry ports 21115–21117 or UDP.
3. **Install.** On the server, run `sudo ./install.sh kg-id.matix.one`. It installs
   `hbbs`/`hbbr` as systemd services and prints the public key.
4. **Firewall.**
   - Open TCP 21115–21117 and UDP 21116.
   - **Keep 21118–21119 closed** to the internet. Only the local proxy may reach them, because
     the servers trust the `X-Real-IP` header on those ports.
5. **Proxy.** Use `nginx.conf` (or `apache.conf` on cPanel). It serves `/web/`, `/ws/id` and `/ws/relay`.
6. **Web client.** `npm run build`, then copy `dist/` to `/var/www/matix-kg/web/` and add a
   `config.json` with the key from step 3.

## Customer app (`matix/brand`)

`matix/brand/apply.sh` makes the build use our server:

- It sets `RENDEZVOUS_SERVERS`, `RS_PUB_KEY` and `APP_NAME=MatixBridge` in `libs/hbb_common`.
- It sets the Windows, Android and iOS product names.
- It copies the icons from `matix/brand/assets`, which `gen_assets.py` renders.

To build:

1. Set the repository variables `MATIX_KG_HOST` (e.g. `kg-id.matix.one`) and `MATIX_KG_KEY`.
2. Run **Actions › MatixBridge native apps**.

That workflow calls RustDesk's own `flutter-build.yml` with `matix-kg: true`. This applies the
branding and skips the Linux and Sciter jobs. The workflow then renames the release files to `MatixBridge-*`.

**Signing:**

- Windows: without a code-signing certificate, SmartScreen warns on the unsigned exe.
- macOS: needs the `MACOS_*` secrets (Developer ID) for a notarised DMG.
- Android: needs `ANDROID_SIGNING_KEY` and its related secrets for an installable APK.
- iOS: needs Apple signing. Upstream's iOS upload step is commented out.

## Upstream workflows on this fork

Disable RustDesk's own `ci.yml`, `flutter-ci.yml`, `flutter-nightly.yml`, `flutter-tag.yml`,
`fdroid.yml`, `playground.yml` and `update-webpki-roots.yml` on the fork (Actions › workflow ›
Disable). Otherwise they run full builds on every PR and push, and the weekly webpki job opens PRs.
