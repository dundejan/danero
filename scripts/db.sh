#!/usr/bin/env bash
# Práce s produkční databází bez toho, aby se připojovací řetězec objevil
# v terminálu, v historii nebo v logu. Čte ho z ~/.danero/produkce.env
# (mimo repozitář, práva 600) — viz docs/08-provoz.md.
#
#   scripts/db.sh status    — počty tabulek, migrací a účtů
#   scripts/db.sh migrate   — aplikuje čekající migrace
#   scripts/db.sh backup    — logický dump do ./zalohy/ (gitignorováno)
#
# Běžné migrace při nasazení řeší GitHub Actions (.github/workflows/migrate.yml),
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

case "${1:-status}" in
  status)
    cd "$REPO/apps/web" && node db/status.mjs
    ;;
  migrate)
    cd "$REPO/apps/web" && pnpm exec drizzle-kit migrate && node db/status.mjs
    ;;
  backup)
    # pg_dump odmítne server novější, než je sám. Neon jede na Postgresu 18,
    # distribuce běžně nabízí starší — místo instalace klienta si proto
    # odpovídající verzi půjčíme z obrazu postgres:<verze>. Když je lokální
    # pg_dump dost nový, použije se přímo (rychlejší, bez Dockeru).
    SERVER_VERSION="$(psql "$DATABASE_URL" -tAc 'SHOW server_version;' 2>/dev/null | cut -d. -f1 || true)"
    DUMP_VERSION="$(pg_dump --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
    if [ -z "$SERVER_VERSION" ]; then
      echo "Nepodařilo se zjistit verzi serveru — je DATABASE_URL_DIRECT správně?" >&2
      exit 1
    fi

    mkdir -p "$REPO/zalohy"
    OUT="$REPO/zalohy/danero-$(date +%F).dump"

    if [ -n "$DUMP_VERSION" ] && [ "$DUMP_VERSION" -ge "$SERVER_VERSION" ]; then
      DUMP_CMD=(pg_dump "$DATABASE_URL" -Fc -f "$OUT")
    elif command -v docker > /dev/null 2>&1; then
      echo "Lokální pg_dump je verze ${DUMP_VERSION:-?}, server běží na $SERVER_VERSION —"
      echo "beru pg_dump z obrazu postgres:$SERVER_VERSION."
      # dump jde na stdout a přesměruje se do souboru: nemusíme do kontejneru
      # mountovat adresář ani řešit práva k zapsanému souboru
      DUMP_CMD=(docker run --rm --network host -e "PGURL=$DATABASE_URL"
        "postgres:$SERVER_VERSION-alpine" sh -c 'pg_dump "$PGURL" -Fc')
    else
      echo "pg_dump je verze ${DUMP_VERSION:-chybí}, ale server běží na $SERVER_VERSION." >&2
      echo "Doinstaluj klienta (sudo apt install postgresql-client-$SERVER_VERSION)," >&2
      echo "nebo nainstaluj Docker — skript si pak verzi půjčí z obrazu sám." >&2
      exit 1
    fi

    # při selhání nesmí zůstat prázdný soubor — vypadal by jako pořízená záloha
    if [ "${DUMP_CMD[0]}" = "docker" ]; then
      if ! "${DUMP_CMD[@]}" > "$OUT"; then
        rm -f "$OUT"
        echo "Záloha se nepořídila, nic jsem nenechal v $REPO/zalohy." >&2
        exit 1
      fi
    elif ! "${DUMP_CMD[@]}"; then
      rm -f "$OUT"
      echo "Záloha se nepořídila, nic jsem nenechal v $REPO/zalohy." >&2
      exit 1
    fi
    if [ ! -s "$OUT" ]; then
      rm -f "$OUT"
      echo "pg_dump skončil úspěchem, ale soubor je prázdný — zálohu neuznávám." >&2
      exit 1
    fi
    echo "záloha: $OUT ($(du -h "$OUT" | cut -f1))"
    echo "⚠️  uchovávej mimo tenhle stroj a ODDĚLENĚ od DANERO_ENCRYPTION_KEY"
    ;;
  *)
    echo "Použití: scripts/db.sh [status|migrate|backup]" >&2
    exit 1
    ;;
esac
