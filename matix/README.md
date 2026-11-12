# Matix KG

Remote support for Matix: a support agent controls a customer's PC from the browser.
It is built on RustDesk (AGPL-3.0). The fork adds three things and leaves upstream code alone:

| Path | What it is |
| --- | --- |
| `matix/web` | **Web client**: our own TypeScript controller that runs in the agent's browser |
| `matix/brand` | Name, icons and the server/key baked into the **customer app** (native RustDesk builds) |
| `matix/server` | Install kit for the **ID/relay server** (RustDesk `hbbs`/`hbbr`) and its TLS proxy |

```
agent's browser ──wss──► kg.matix.one (Cloudflare ► nginx/Apache) ──► hbbs :21118 / hbbr :21119
                                                                          ▲            ▲
customer's Matix KG app ──tcp/udp 21115-21117──► kg-id.matix.one (DNS only) ┘            │
                        └──────────────── relayed session (always, for web) ─────────────┘
```

A browser can only be the controlling side. Customers run the Matix KG app; agents use
`https://kg.matix.one/web/`, or the app itself.

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
{ "idServer": "wss://kg.matix.one/ws/id", "relayServer": "wss://kg.matix.one/ws/relay", "key": "<id_ed25519.pub>" }
```

CI (`.github/workflows/matix-web-e2e.yml`) starts an unmodified RustDesk peer on a virtual X
display behind our own `hbbs`/`hbbr`, then runs:

- the Node smoke test;
- the file-transfer test;
- a headless-Chromium test that checks video reaches the canvas and that typed keys change the remote screen.

**Local testing pitfall:** bind `hbbs`/`hbbr` to a LAN IP, never `127.0.0.1`. `hbbr` treats
TCP connections from loopback as its admin console, so a local peer's relay connection gets reset.

## Server (`matix/server`)

1. **Host.** Any small Linux VM works. Pick one close to the customers, since web sessions
   are always relayed (a Gulf region suits Egypt).
2. **DNS (Cloudflare).**
   - `kg.matix.one`: proxied (orange). Carries the web client and its WebSockets.
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

- It sets `RENDEZVOUS_SERVERS`, `RS_PUB_KEY` and `APP_NAME=MatixKG` in `libs/hbb_common`.
- It sets the Windows, Android and iOS product names.
- It copies the icons from `matix/brand/assets`, which `gen_assets.py` renders.

To build:

1. Set the repository variables `MATIX_KG_HOST` (e.g. `kg-id.matix.one`) and `MATIX_KG_KEY`.
2. Run **Actions › Matix KG native apps**.

That workflow calls RustDesk's own `flutter-build.yml` with `matix-kg: true`. This applies the
branding and skips the Linux and Sciter jobs. The workflow then renames the release files to `MatixKG-*`.

**Signing:**

- Windows: without a code-signing certificate, SmartScreen warns on the unsigned exe.
- macOS: needs the `MACOS_*` secrets (Developer ID) for a notarised DMG.
- Android: needs `ANDROID_SIGNING_KEY` and its related secrets for an installable APK.
- iOS: needs Apple signing. Upstream's iOS upload step is commented out.

## Upstream workflows on this fork

Disable RustDesk's own `ci.yml`, `flutter-ci.yml`, `flutter-nightly.yml`, `flutter-tag.yml`,
`fdroid.yml`, `playground.yml` and `update-webpki-roots.yml` on the fork (Actions › workflow ›
Disable). Otherwise they run full builds on every PR and push, and the weekly webpki job opens PRs.
