#!/usr/bin/env bash
# Turns this RustDesk checkout into the MatixBridge customer app before a native build:
# our server and key baked in, our name and icons. Run from the repo root (CI does it
# right after checkout). Needs MATIX_KG_HOST and MATIX_KG_KEY.
set -euo pipefail

: "${MATIX_KG_HOST:?set MATIX_KG_HOST to the DNS-only ID server name, e.g. kg-id.matix.one}"
: "${MATIX_KG_KEY:?set MATIX_KG_KEY to the server public key (id_ed25519.pub)}"
APP_ID="MatixBridge"          # internal name: config folders, IPC paths, service names
DISPLAY_NAME="MatixBridge"

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

# perl -pi works the same on Linux, macOS and Git Bash on Windows (unlike sed -i).
sub() { # file, perl substitution; fails if nothing matched
  local file="$1" expr="$2"
  perl -0pi -e "\$n += ($expr); END { exit(\$n ? 0 : 3) }" "$file" || { echo "brand: no match in $file for $expr"; exit 1; }
}

cfg=libs/hbb_common/src/config.rs
sub "$cfg" "s/pub const RENDEZVOUS_SERVERS: &\[&str\] = &\[[^\]]*\];/pub const RENDEZVOUS_SERVERS: &[&str] = &[\"$MATIX_KG_HOST\"];/"
sub "$cfg" "s/pub const RS_PUB_KEY: &str = \"[^\"]*\";/pub const RS_PUB_KEY: &str = \"$MATIX_KG_KEY\";/"
sub "$cfg" "s/(pub static ref APP_NAME: RwLock<String> = RwLock::new\()\"RustDesk\"/\$1\"$APP_ID\"/"
# Receive-only: the customer app shows its ID and password and can be controlled, but cannot
# control other computers (agents connect from agents.matix.one/bridge/). Upstream's "incoming only"
# custom-client mode, which is normally set from a signed custom.txt; here it is the built-in default.
sub "$cfg" 's/pub static ref HARD_SETTINGS: RwLock<HashMap<String, String>> = Default::default\(\);/pub static ref HARD_SETTINGS: RwLock<HashMap<String, String>> = RwLock::new(HashMap::from([("conn-type".to_owned(), "incoming".to_owned())]));/'

sub flutter/windows/runner/Runner.rc 's/VALUE "FileDescription", "RustDesk Remote Desktop"/VALUE "FileDescription", "'"$DISPLAY_NAME"' Remote Support"/'
sub flutter/windows/runner/Runner.rc 's/VALUE "ProductName", "RustDesk"/VALUE "ProductName", "'"$DISPLAY_NAME"'"/'
perl -0pi -e 's/VALUE "CompanyName", "[^"]*"/VALUE "CompanyName", "Sismatix Information Systems"/; s/VALUE "LegalCopyright", "[^"]*"/VALUE "LegalCopyright", "Copyright \(C\) 2026 Sismatix Information Systems. MatixBridge is based on RustDesk \(AGPL-3.0\)."/' flutter/windows/runner/Runner.rc
sub flutter/android/app/src/main/AndroidManifest.xml 's/android:label="RustDesk"/android:label="'"$DISPLAY_NAME"'"/'
sub flutter/android/app/src/main/AndroidManifest.xml 's/android:label="RustDesk Input"/android:label="'"$DISPLAY_NAME"' Input"/'
sub flutter/ios/Runner/Info.plist 's#(<key>CFBundleDisplayName</key>\s*<string>)RustDesk(</string>)#${1}'"$DISPLAY_NAME"'${2}#'

# Android adaptive icon: our foreground is the white Matix mark, so the tile is Matix cyan.
sub flutter/android/app/src/main/res/values/ic_launcher_background.xml 's/<color name="ic_launcher_background">#ffffff<\/color>/<color name="ic_launcher_background">#06b6d4<\/color>/'

# The window the customer answers (connection manager): big, centred, one clear Arabic/English
# Accept button for the connection and for voice calls, no permission icons.
git apply --whitespace=nowarn matix/brand/cm-window.patch || { echo "brand: cm-window.patch does not apply"; exit 1; }

# Forced update: the app reports its build and checks the minimum at agents.matix.one/bridge/config.json
# ("minAppBuild"); an older app shows only an Update screen, and agents' web client refuses it.
# The build comes from the release tag: matixbridge-v0.7 -> 7, matixbridge-v1.2 -> 102, other tags 0.
MATIX_BUILD=0
if [[ "${TAG_NAME:-}" =~ ^matixbridge-v([0-9]+)\.([0-9]+)$ ]]; then
  MATIX_BUILD=$(( BASH_REMATCH[1] * 100 + BASH_REMATCH[2] ))
fi
git apply --whitespace=nowarn matix/brand/update-check.patch || { echo "brand: update-check.patch does not apply"; exit 1; }
sub src/server/connection.rs "s/const MATIX_BUILD: i64 = 0;/const MATIX_BUILD: i64 = $MATIX_BUILD;/"
sub flutter/lib/matix_update.dart "s/const int kMatixBuild = 0;/const int kMatixBuild = $MATIX_BUILD;/"
echo "brand: MatixBridge build $MATIX_BUILD"

# Icons: same paths and sizes as upstream, pre-rendered by matix/brand/gen_assets.py.
(cd matix/brand/assets && find . -type f) | while read -r f; do
  cp "matix/brand/assets/$f" "$f"
done

echo "brand: MatixBridge applied (server $MATIX_KG_HOST)"
