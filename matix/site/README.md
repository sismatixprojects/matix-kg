# MatixBridge download page

Live at **https://matixerp.com/matixbridge/**. matixerp.com is a static site in the cPanel account `matixerpcom` on
72.52.136.5 and has no repository of its own, so this folder is a copy of the deployed page.

- `matixerp.com/matixbridge/index.html` is the page itself. It is Arabic first; the site's EN switch uses `window.PAGE_T`.
  The shared header and footer are copied from the other matixerp.com pages, and `/matix-shared.js` drives them.
- The visitor's OS picks the main download button: Windows gets the installer, macOS gets the Apple Silicon `.dmg` (or the
  Intel one when the GPU reports Intel/AMD), phones scroll to the download cards.
- App files are served from the same origin under fixed names, so links never change between versions:
  - `/matixbridge/download/MatixBridge-Windows-Setup.msi`: the main Windows download. It installs to
    Program Files and adds desktop and Start-menu shortcuts (checked by `matix-verify-packages.yml`).
    `MatixBridge-Windows-Installer.msi` is the same file under its older name.
  - `/matixbridge/download/MatixBridge-Windows.exe`: portable, x64, runs without installing.
  - `/matixbridge/download/MatixBridge-macOS.dmg`: Apple Silicon, native arm64, so no Rosetta prompt.
  - `/matixbridge/download/MatixBridge-macOS-Intel.dmg`: Intel x86_64.

  A `.htaccess` in `download/` forces `Content-Disposition: attachment`.

**Publishing a new version.** On the server, as root:

```bash
D=/home/matixerpcom/public_html/matixbridge/download
U=https://github.com/sismatixprojects/matixbridge/releases/download/<tag>
curl -fsSL -o $D/MatixBridge-Windows-Setup.msi $U/MatixBridge-<ver>-x86_64.msi
cp $D/MatixBridge-Windows-Setup.msi $D/MatixBridge-Windows-Installer.msi
curl -fsSL -o $D/MatixBridge-Windows.exe $U/MatixBridge-<ver>-x86_64.exe
curl -fsSL -o $D/MatixBridge-macOS.dmg $U/MatixBridge-<ver>-aarch64.dmg
curl -fsSL -o $D/MatixBridge-macOS-Intel.dmg $U/MatixBridge-<ver>-x86_64.dmg
chown matixerpcom:matixerpcom $D/*
```

Then update the version and sizes in the page text (`dl_*_meta`, the cards).
