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
agent's browser ──wss──► bridge.matix.one (Cloudflare ► nginx/Apache) ──► hbbs :21118 / hbbr :21119
                                                                          ▲            ▲
customer's MatixBridge app ──tcp/udp 21115-21117──► kg-id.matix.one (DNS only) ┘            │
                        └──────────────── relayed session (always, for web) ─────────────┘
```

A browser can only be the controlling side. Customers run the MatixBridge app; agents use
`https://bridge.matix.one/web/`, or the app itself.

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
{ "idServer": "wss://bridge.matix.one/ws/id", "relayServer": "wss://bridge.matix.one/ws/relay", "key": "<id_ed25519.pub>" }
```

CI (`.github/workflows/matix-web-e2e.yml`) starts an unmodified RustDesk peer on a virtual X
display behind our own `hbbs`/`hbbr`, then runs:

- the Node smoke test;
- the file-transfer test;
- a headless-Chromium test that checks video reaches the canvas and that typed keys change the remote screen.

**Local testing pitfall:** bind `hbbs`/`hbbr` to a LAN IP, never `127.0.0.1`. `hbbr` treats
TCP connections from loopback as its admin console, so a local peer's relay connection gets reset.

## Production (since 2026-11-12)

- **Web client:** https://bridge.matix.one/web/ (Cloudflare proxied). `kg.matix.one` 301-redirects there, but its
  `/ws/*` paths still work. Files live in the cPanel account `kgmatix`, where `bridge.matix.one` is a parked domain,
  under `public_html/web/`, served through the Apache include in `matix/server/apache.conf`.
- **ID/relay server:** systemd units `matix-kg-hbbs` and `matix-kg-hbbr` on 72.52.136.5 (US). Data is in
  `/var/lib/matix-kg`, and the public key is `0sY5K0X3HCRHqb4wfySRcEk1zJTzUmeeW5n3UUMLL9c=`.
  - CSF opens TCP 21115:21117 and UDP 21116. Ports 21118/21119 are reachable only through Apache.
  - The customer app reaches the server by IP. Moving hosts means rebuilding the apps, or using a DNS-only name.
- **Update the web client:** `npm run build`, then put the production `config.json` into `dist/`, then
  `rsync -a --delete dist/ root@72.52.136.5:/home/kgmatix/public_html/web/` (port 522), then
  `chown -R kgmatix:kgmatix`.

## Server (`matix/server`)

1. **Host.** Any small Linux VM works. Pick one close to the customers, since web sessions
   are always relayed (a Gulf region suits Egypt).
2. **DNS (Cloudflare).**
   - `bridge.matix.one`: proxied (orange). Carries the web client and its WebSockets.
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
