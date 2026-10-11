#!/usr/bin/env bash
# WebKit (jádro Safari) z Playwrightu na stroji bez systémových knihoven a bez roota.
#
# Playwright si WebKit stáhne (`playwright install webkit`), ale na Linuxu k němu
# potřebuje GTK 4, GStreamer a pár dalších knihoven ze systému. Kde je nejde
# doinstalovat (`playwright install-deps` chce roota), stáhne je tenhle skript
# jako balíčky do domovského adresáře, rozbalí je a prohlížeč pustí pod nimi.
# Do systému nezapisuje nic.
#
#   scripts/webkit-local.sh                     # jen připraví knihovny a vypíše cestu k obalu
#   scripts/webkit-local.sh pnpm test:e2e       # celá E2E sada ve WebKitu
#   scripts/webkit-local.sh node muj-skript.mjs # vlastní skript; obal je v E2E_WEBKIT_EXECUTABLE
#
# Seznam balíčků je ověřený na Ubuntu 22.04 (WSL) s Playwrightem 1.61. Na jiném
# vydání se můžou jmenovat jinak — skript na konci vypíše, co pořád chybí.
# V CI ani na stroji s rootem tohle potřeba není: `playwright install --with-deps webkit`.
set -euo pipefail

CACHE_DIR="${DANERO_WEBKIT_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/danero-webkit}"
DEBS_DIR="$CACHE_DIR/debs"
ROOT_DIR="$CACHE_DIR/root"
WRAPPER="$CACHE_DIR/webkit-run.sh"
BROWSERS_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

PACKAGES=(
  libgtk-4-1 libgraphene-1.0-0 libcairo-script-interpreter2
  libgstreamer-plugins-base1.0-0 libgstreamer-gl1.0-0 libgstreamer-plugins-bad1.0-0 liborc-0.4-0
  libharfbuzz-icu0 libmanette-0.2-0 libevdev2 libgudev-1.0-0
  libenchant-2-2 libhyphen0 libsecret-1-0 libwoff1 libgles2
)

# nejnovější stažené sestavení WebKitu (adresář webkit-<číslo>)
bundle="$(find "$BROWSERS_DIR" -maxdepth 1 -type d -name 'webkit-*' 2>/dev/null | sort -V | tail -n 1)"
if [[ -z "$bundle" ]]; then
  echo "WebKit z Playwrightu tu není — nejdřív: pnpm --filter @danero/web exec playwright install webkit" >&2
  exit 1
fi

libs_dir="$ROOT_DIR/usr/lib/$(uname -m)-linux-gnu"

if [[ ! -f "$CACHE_DIR/ready" ]]; then
  mkdir -p "$DEBS_DIR" "$ROOT_DIR"
  (cd "$DEBS_DIR" && apt-get download "${PACKAGES[@]}" >&2)
  for deb in "$DEBS_DIR"/*.deb; do
    dpkg-deb -x "$deb" "$ROOT_DIR"
  done
  touch "$CACHE_DIR/ready"
fi

# Obal dělá totéž co `pw_run.sh` z Playwrightu, jen k jeho knihovnám přidá ty
# naše — původní obal si LD_LIBRARY_PATH přepisuje, takže ho nejde jen nastavit.
cat >"$WRAPPER" <<EOF
#!/bin/sh
folder="minibrowser-gtk"
case "\$*" in *--headless*) folder="minibrowser-wpe" ;; esac
dir="$bundle/\$folder"
export WEBKIT_EXEC_PATH="\$dir/bin"
export WEBKIT_INJECTED_BUNDLE_PATH="\$dir/lib"
export WEBKIT_INSPECTOR_RESOURCES_PATH="\$dir/share"
export LD_LIBRARY_PATH="\$dir/lib:\$dir/sys/lib:$libs_dir"
export WEBKIT_FORCE_COMPLEX_TEXT=1
exec "\$dir/bin/MiniBrowser" "\$@"
EOF
chmod +x "$WRAPPER"

# co prohlížeči pořád chybí (jiné vydání systému, nová verze WebKitu)
missing="$(
  for kind in wpe gtk; do
    dir="$bundle/minibrowser-$kind"
    for binary in "$dir"/bin/*; do
      LD_LIBRARY_PATH="$dir/lib:$dir/sys/lib:$libs_dir" ldd "$binary" 2>/dev/null | grep 'not found' || true
    done
  done | sort -u
)"
if [[ -n "$missing" ]]; then
  echo "WebKitu pořád chybějí knihovny — doplň balíčky do PACKAGES a smaž $CACHE_DIR/ready:" >&2
  echo "$missing" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "$WRAPPER"
  exit 0
fi

export E2E_BROWSER=webkit
export E2E_WEBKIT_EXECUTABLE="$WRAPPER"
exec "$@"
