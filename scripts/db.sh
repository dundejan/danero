#!/usr/bin/env bash
# Práce s produkční databází bez toho, aby se připojovací řetězec objevil
# v terminálu, v historii nebo v logu. Čte ho z ~/.danero/produkce.env
# (mimo repozitář, práva 600) — viz docs/08-provoz.md.
#
#   scripts/db.sh status    — počty tabulek, migrací a účtů
#   scripts/db.sh migrate   — aplikuje čekající migrace
#   scripts/db.sh backup    — logický dump do ./zalohy/ (gitignorováno) + úklid starých
#   scripts/db.sh prune     — jen úklid: smaže zálohy starší než retenční lhůta
#   scripts/db.sh restore SOUBOR — obnova ze zálohy (ptá se na potvrzení!)
#
# Běžné migrace při nasazení řeší GitHub Actions (.github/workflows/migrate.yml),
# tenhle skript je pro ruční zásahy a zálohy.

set -euo pipefail

ENV_FILE="${DANERO_PROD_ENV:-$HOME/.danero/produkce.env}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Kam se ukládají dumpy. Přepínatelné kvůli testům a kvůli tomu, aby si Jan
# mohl zálohy držet mimo repozitář (na šifrovaném disku).
BACKUP_DIR="${DANERO_BACKUP_DIR:-$REPO/zalohy}"

# Jak dlouho se záloha smí uchovávat, ve dnech.
#
# 56 dní = 8 týdnů. Není to kosmetika: /soukromi slibuje uživateli, že smazaná
# data zmizí i ze záloh, a doba uložení je povinný údaj podle čl. 13 odst. 2
# písm. a) GDPR. Do 7. 8. 2026 za tím slibem nestál žádný mechanismus — skript
# zálohu jen vytvořil a nikdy nic nemazal (nález E-32).
BACKUP_RETENTION_DAYS="${DANERO_BACKUP_RETENTION_DAYS:-56}"

# Smaže dumpy starší než retenční lhůta. Vypisuje, co zmizelo — mlčící úklid
# u záloh je ta nejhorší varianta.
#
# `-mtime +N` bere celé 24hodinové úseky a zaokrouhluje dolů, takže „starší než
# 56 dní" se zapisuje jako `+55`. S `+56` by se soubor mazal až 57. den a slib
# „nejdéle 56 dní" by neplatil o den.
prune_backups() {
  if [ ! -d "$BACKUP_DIR" ]; then
    echo "úklid: $BACKUP_DIR neexistuje, žádné zálohy k úklidu"
    return 0
  fi
  local smazane
  smazane="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'danero-*.dump' \
    -mtime "+$((BACKUP_RETENTION_DAYS - 1))" -print -delete)"
  if [ -n "$smazane" ]; then
    echo "úklid: smazáno $(printf '%s\n' "$smazane" | wc -l) záloh starších než ${BACKUP_RETENTION_DAYS} dní:"
    printf '%s\n' "$smazane" | sed 's/^/  /'
  else
    echo "úklid: žádná záloha není starší než ${BACKUP_RETENTION_DAYS} dní"
  fi
}

# Připojovací řetězec načítáme až u příkazů, které databázi opravdu potřebují —
# `prune` sahá jen na soubory a nesmí kvůli chybějícímu env souboru selhat.
load_database_url() {
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
}

case "${1:-status}" in
  status)
    load_database_url
    cd "$REPO/apps/web" && node db/status.mjs
    ;;
  migrate)
    load_database_url
    cd "$REPO/apps/web" && pnpm exec drizzle-kit migrate && node db/status.mjs
    ;;
  prune)
    prune_backups
    ;;
  backup)
    load_database_url
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

    mkdir -p "$BACKUP_DIR"
    OUT="$BACKUP_DIR/danero-$(date +%F).dump"

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
        echo "Záloha se nepořídila, nic jsem nenechal v $BACKUP_DIR." >&2
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
    # retence běží hned po úspěšné záloze: kdyby se čistilo předem, po každém
    # neúspěšném dumpu by ubyla i poslední použitelná záloha
    prune_backups
    echo "⚠️  kopii uloženou jinam (S3, disk) smaž po ${BACKUP_RETENTION_DAYS} dnech taky —"
    echo "    tenhle skript uklidí jen $BACKUP_DIR"
    ;;
  restore)
    # Obnova ze zálohy do PRÁZDNÉ nebo existující databáze.
    #
    # Runbook do 9. 8. 2026 doporučoval `pg_restore -d URL --clean dump`. Na
    # produkčním dumpu to dalo **105 chyb a přesto exit 0** (vlastnictví
    # `neondb_owner` v cizím clusteru neexistuje), takže by v nich skutečná
    # chyba zanikla — a `--clean` bez `--if-exists` navíc nechal v cíli
    # objekty, které v záloze nejsou: obnova do neprázdné databáze skončila
    # míchanicí 1 původního a 16 obnovených uživatelů (nález F-3-6, M-3-03).
    #
    # Přepínače, které to řeší (ověřeno: 0 chyb, exit 0, přesně stav zálohy):
    #   --clean --if-exists   zahodí objekty ze zálohy, i když v cíli nejsou
    #   --no-owner            nepokouší se nastavit vlastníka z Neonu
    #   --no-privileges       totéž pro GRANTy
    #   --exit-on-error       PRVNÍ skutečná chyba běh zastaví, ne aby se
    #                         schovala mezi stovkou neškodných
    DUMP="${2:-}"
    if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
      echo "Použití: scripts/db.sh restore CESTA/K/ZALOZE.dump" >&2
      echo "Dostupné zálohy:" >&2
      ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -5 >&2 || echo "  (žádné v $BACKUP_DIR)" >&2
      exit 1
    fi
    load_database_url

    # Obnova PŘEPISUJE cílovou databázi — bez potvrzení se nespouští.
    echo "⚠️  Obnova přepíše databázi, na kterou míří DATABASE_URL_DIRECT."
    echo "Stav před obnovou:"
    (cd "$REPO/apps/web" && node db/status.mjs)
    printf 'Opravdu obnovit z %s? Napiš OBNOVIT: ' "$DUMP"
    read -r POTVRZENI
    if [ "$POTVRZENI" != "OBNOVIT" ]; then
      echo "Zrušeno, nic se nezměnilo."
      exit 1
    fi

    SERVER_VERSION="$(psql "$DATABASE_URL" -tAc 'SHOW server_version;' 2>/dev/null | cut -d. -f1 || true)"
    RESTORE_VERSION="$(pg_restore --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
    RESTORE_ARGS=(--clean --if-exists --no-owner --no-privileges --exit-on-error)

    if [ -n "$RESTORE_VERSION" ] && [ -n "$SERVER_VERSION" ] && [ "$RESTORE_VERSION" -ge "$SERVER_VERSION" ]; then
      pg_restore -d "$DATABASE_URL" "${RESTORE_ARGS[@]}" "$DUMP"
    elif command -v docker > /dev/null 2>&1; then
      echo "Lokální pg_restore je verze ${RESTORE_VERSION:-?}, beru ho z obrazu postgres:${SERVER_VERSION:-18}."
      # PGURL se musí rozbalit až UVNITŘ kontejneru, proto `sh -c`
      docker run --rm --network host -e "PGURL=$DATABASE_URL" \
        -v "$(cd "$(dirname "$DUMP")" && pwd):/zalohy:ro" \
        "postgres:${SERVER_VERSION:-18}-alpine" \
        sh -c "pg_restore -d \"\$PGURL\" ${RESTORE_ARGS[*]} /zalohy/$(basename "$DUMP")" \
        || { echo "Obnova selhala." >&2; exit 1; }
    else
      echo "Chybí pg_restore i Docker — nemám čím obnovit." >&2
      exit 1
    fi

    echo "Obnoveno. Stav po:"
    (cd "$REPO/apps/web" && node db/status.mjs)
    ;;
  *)
    echo "Použití: scripts/db.sh [status|migrate|backup|prune|restore SOUBOR]" >&2
    exit 1
    ;;
esac
