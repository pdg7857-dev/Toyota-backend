#!/usr/bin/env bash
# Pull a game client off a connected Android device into reference/client/.
#
# Run this on the machine the device is plugged into — it needs adb and USB,
# neither of which exists in a cloud session.
#
# Usage:
#   tools/extract/pull_client.sh                 # auto-detect a Celtic Heroes install
#   tools/extract/pull_client.sh com.foo.bar     # explicit package name
#   SEARCH=druid tools/extract/pull_client.sh    # different auto-detect term

set -euo pipefail

DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/reference/client"
SEARCH="${SEARCH:-celtic}"

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

command -v adb >/dev/null 2>&1 || die "adb not found.
  macOS:   brew install android-platform-tools
  Linux:   sudo apt install adb
  Windows: install Android SDK Platform-Tools and add it to PATH"

echo "==> Checking for a connected device"
adb start-server >/dev/null 2>&1 || true
# Column 2 is the state; anything other than 'device' is not usable yet.
mapfile -t READY < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')
mapfile -t UNAUTH < <(adb devices | awk 'NR>1 && $2=="unauthorized" {print $1}')

if [ "${#UNAUTH[@]}" -gt 0 ]; then
  die "device ${UNAUTH[0]} is unauthorized.
  Unlock the phone and tap 'Allow' on the USB debugging prompt, then re-run."
fi
case "${#READY[@]}" in
  0) die "no device detected.
  - Enable Developer options: Settings > About phone > tap 'Build number' 7 times
  - Enable USB debugging in Developer options
  - Plug in over USB and set the connection mode to file transfer (MTP)
  - An emulator with a Play Store image works too" ;;
  1) SERIAL="${READY[0]}" ;;
  *) SERIAL="${ADB_SERIAL:-}"
     [ -n "$SERIAL" ] || die "several devices connected: ${READY[*]}
  Re-run with ADB_SERIAL=<serial> to choose one." ;;
esac
adb() { command adb -s "$SERIAL" "$@"; }
note "using $SERIAL"

echo "==> Resolving the package"
if [ $# -ge 1 ]; then
  PKG="$1"
  adb shell pm path "$PKG" >/dev/null 2>&1 || die "package '$PKG' is not installed on $SERIAL"
else
  mapfile -t HITS < <(adb shell pm list packages 2>/dev/null \
                      | tr -d '\r' | sed 's/^package://' | grep -i -- "$SEARCH" || true)
  case "${#HITS[@]}" in
    0) die "no installed package matching '$SEARCH'.
  Install the game from the Play Store first, or list everything with:
    adb -s $SERIAL shell pm list packages | sort
  then re-run as: $0 <package.name>" ;;
    1) PKG="${HITS[0]}" ;;
    *) printf '\nSeveral packages match "%s":\n' "$SEARCH"
       printf '  %s\n' "${HITS[@]}"
       die "re-run with the one you want: $0 <package.name>" ;;
  esac
fi
note "package: $PKG"

echo "==> Launching the app once so it fetches its content"
note "(many mobile games download most assets on first run)"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
  || note "could not auto-launch; open the game by hand if the OBB comes back empty"

mkdir -p "$DEST"

echo "==> Pulling APKs"
mapfile -t APKS < <(adb shell pm path "$PKG" | tr -d '\r' | sed 's/^package://' | grep -v '^$')
[ "${#APKS[@]}" -gt 0 ] || die "pm path returned nothing for $PKG"
note "${#APKS[@]} APK(s) in this install"
for remote in "${APKS[@]}"; do
  base="$(basename "$remote")"
  note "$base"
  adb pull "$remote" "$DEST/$base" >/dev/null \
    || die "failed to pull $remote
  Some devices restrict /data/app reads. Try: adb shell run-as $PKG, or use an emulator."
done

echo "==> Pulling OBB expansion (if any)"
OBB_DIR="/sdcard/Android/obb/$PKG"
mapfile -t OBBS < <(adb shell "ls $OBB_DIR/*.obb 2>/dev/null" | tr -d '\r' | grep -v '^$' || true)
if [ "${#OBBS[@]}" -eq 0 ]; then
  note "none found — fine if the game ships assets inside the APK,"
  note "but if stage 0 reports an empty assets/bin/Data, open the game,"
  note "let it finish downloading, and re-run this script"
else
  for remote in "${OBBS[@]}"; do
    base="$(basename "$remote")"
    note "$base"
    adb pull "$remote" "$DEST/$base" >/dev/null || die "failed to pull $remote"
  done
fi

echo
echo "==> Done. In $DEST:"
ls -lh "$DEST" | tail -n +2 | awk '{printf "  %-52s %s\n", $NF, $5}'
SPLITS=$(ls "$DEST"/split_*.apk 2>/dev/null | wc -l | tr -d ' ')
[ "$SPLITS" -gt 0 ] && echo "  (split install: $SPLITS config APK(s) — all pulled)"
echo
echo "Next:  python tools/extract/00_probe.py"
