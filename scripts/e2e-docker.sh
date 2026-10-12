#!/usr/bin/env bash
# E2E sada ve Firefoxu nebo ve WebKitu (jádro Safari) uvnitř kontejneru Dockeru.
#
#   scripts/e2e-docker.sh webkit                        # celá sada
#   scripts/e2e-docker.sh firefox e2e/demo.spec.ts      # další argumenty jdou Playwrightu
#   scripts/e2e-docker.sh webkit -- bash                # za „--“ libovolný příkaz v kontejneru
#
# Proč kontejner a ne stroj: WebKit z Playwrightu puštěný ve WSL lokálně (nad
# knihovnami rozbalenými do domovského adresáře) 11. 10. 2026 dvakrát za večer
# nejspíš shodil celé WSL — těsně před pádem byly v jádře stovky hlášek `dxgk`
# za minutu (grafický ovladač WSL, `/dev/dxg`). V kontejneru to zařízení není,
# a skript se o tom před spuštěním přesvědčí. Viz „Známé zrady“ v CLAUDE.md.
#
# Jak to běží: oficiální obraz Playwrightu ve verzi shodné s `@playwright/test`
# z lockfile (prohlížeče i jejich systémové knihovny jsou v něm), strom
# repozitáře připojený na stejné cestě, dev server i prohlížeč UVNITŘ
# kontejneru — publikované porty kontejneru z WSL nedosáhneš a naopak to není
# potřeba. Vlastní `NEXT_DIST_DIR` drží sestavení stranou od `pnpm dev` na
# stroji; databáze E2E je jako vždy v dočasném adresáři (tady uvnitř kontejneru).
#
# Výchozí `pnpm test:e2e` a CI zůstávají na Chromiu, tenhle skript je navíc.
# Souběžně s lokálním E2E ho nepouštěj: oba běhy píšou do `apps/web/.data`
# a `apps/web/test-results`.
set -euo pipefail

usage() {
  echo "Použití: scripts/e2e-docker.sh <firefox|webkit|chromium> [argumenty Playwrightu… | -- příkaz…]" >&2
  exit 2
}

browser="${1:-}"
case "$browser" in
  firefox | webkit | chromium) shift ;;
  *) usage ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('$root/apps/web/node_modules/@playwright/test/package.json').version")"
image="mcr.microsoft.com/playwright:v${version}-noble"

if [[ "${1:-}" == "--" ]]; then
  shift
  [[ $# -gt 0 ]] || usage
  command=("$@")
else
  command=(pnpm test:e2e "$@")
fi

tty=()
[[ -t 0 && -t 1 ]] && tty=(-it)

# E2E_DOCKER_ARGS: další přepínače pro `docker run` (připojení adresáře se
# snímky, jméno kontejneru…), oddělené mezerou.
# shellcheck disable=SC2206
extra=(${E2E_DOCKER_ARGS:-})

# Uvnitř: uživatel ze stroje (soubory ve stromu nezůstanou rootovi), domov
# v /tmp, pnpm přes corepack ve verzi z `packageManager`.
exec docker run --rm --init --ipc=host "${tty[@]}" "${extra[@]}" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/home \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e NEXT_TELEMETRY_DISABLED=1 \
  -e E2E_BROWSER="$browser" \
  -e NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-e2e-docker}" \
  -e CI="${CI:-}" \
  -v "$root:$root" \
  -w "$root" \
  "$image" \
  bash -euo pipefail -c '
    if [[ -e /dev/dxg ]]; then
      echo "V kontejneru je /dev/dxg — grafický ovladač WSL, kvůli kterému tu prohlížeč běžet nemá. Končím." >&2
      exit 1
    fi
    # Výchozí bezpatkové písmo obrazu je čínské (WenQuanYi Zen Hei) a každý
    # prohlížeč si „systémové písmo“ vyloží jinak. Jedno latinkové pro všechny,
    # ať se dá rozložení mezi prohlížeči porovnávat.
    mkdir -p "$HOME/bin" "$HOME/.config/fontconfig"
    cat >"$HOME/.config/fontconfig/fonts.conf" <<FONTS
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <alias binding="strong"><family>sans-serif</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="strong"><family>system-ui</family><prefer><family>Liberation Sans</family></prefer></alias>
</fontconfig>
FONTS
    corepack enable --install-directory "$HOME/bin"
    export PATH="$HOME/bin:$PATH"
    exec "$@"
  ' e2e-docker "${command[@]}"
