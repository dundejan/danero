#!/usr/bin/env bash
# Práce s produkční databází bez toho, aby se připojovací řetězec objevil
# v terminálu, v historii nebo v logu. Čte ho z ~/.danero/produkce.env
# (mimo repozitář, práva 600) — viz docs/08-provoz.md.
#
#   scripts/db.sh stav      — počty tabulek, migrací a účtů
#   scripts/db.sh migrace   — aplikuje čekající migrace
#   scripts/db.sh zaloha    — logický dump do ./zalohy/ (gitignorováno)
#
# Běžné migrace při nasazení řeší GitHub Actions (.github/workflows/migrace.yml),
# tenhle skript je pro ruční zásahy a zálohy.

set -euo pipefail

ENV_FILE="${DANERO_PROD_ENV:-$HOME/.danero/produkce.env}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$ENV_FILE" ]; then
  echo "Chybí $ENV_FILE — vytvoř ho s řádkem DATABASE_URL_DIRECT=postgres://…" >&2
  echo "(přímý, NEpoolovaný řetězec z Neonu; chmod 600)" >&2
  exit 1
fi

# jen vytažení hodnoty, žádné sourcování celého souboru — to by shell mohl
# vypsat do výstupu (job control) a tajemství by skončilo v logu konverzace
DATABASE_URL="$(grep -m1 '^DATABASE_URL_DIRECT=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'')"
export DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "V $ENV_FILE chybí řádek DATABASE_URL_DIRECT=…" >&2
  exit 1
fi

case "${1:-stav}" in
  stav)
    cd "$REPO/apps/web" && node db/status.mjs
    ;;
  migrace)
    cd "$REPO/apps/web" && pnpm exec drizzle-kit migrate && node db/status.mjs
    ;;
  zaloha)
    mkdir -p "$REPO/zalohy"
    OUT="$REPO/zalohy/danero-$(date +%F).dump"
    pg_dump "$DATABASE_URL" -Fc -f "$OUT"
    echo "záloha: $OUT ($(du -h "$OUT" | cut -f1))"
    echo "⚠️  uchovávej mimo tenhle stroj a ODDĚLENĚ od DANERO_ENCRYPTION_KEY"
    ;;
  *)
    echo "Použití: scripts/db.sh [stav|migrace|zaloha]" >&2
    exit 1
    ;;
esac
