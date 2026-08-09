-- B-3-2: dedupe klíč se počítal z otisku SYROVÉHO řádku výpisu — u Schwabu,
-- Tastytrade, Revolutu i Saxa doslova `fnv1a64(row.join('|'))`, u ostatních
-- brokerů přes `tx.id`, který z téhož otisku vzniká. Jakmile broker změnil tvar
-- exportu (koncová čárka, přidaný sloupec „Total", jiné pořadí sloupců), vyšel
-- jiný klíč a tatáž transakce se uložila PODRUHÉ, zatímco import hlásil
-- „0 duplicit". Doloženo třemi tvary téhož obchodu Schwabu (3 transakce místo
-- jedné) a 20- vs. 21sloupcovým exportem Tastytrade (2 místo jedné).
--
-- Klíč nově stojí jen na obsahu události (typ, datum, instrument, kusy, cena,
-- měna) a na POŘADÍ VÝSKYTU, které odlišuje obsahově nerozlišitelné, ale
-- legitimní události (dvě částečná plnění stejného objemu za stejnou cenu).
-- Tvar: `<broker>|<otisk obsahu>|<pořadí>`.
--
-- Tahle migrace srovnává už uložená data. Bez přepočtu by se každý dosud
-- importovaný řádek při dalším importu téhož výpisu uložil znovu.
--
-- Co migrace ZÁMĚRNĚ nedělá: nemaže řádky, které stará chyba zdvojila. Dva
-- obsahově shodné záznamy totiž z databáze nejdou odlišit od dvou legitimních
-- částečných plnění, takže by mazání bralo i poctivá data. Zdvojené řádky
-- dostanou pořadí 1, 2, 3… a zůstávají — kdo je má, smaže v Importu příslušnou
-- dávku (tlačítko „Smazat záznam“ u nahraného souboru).

-- FNV-1a 64bit, přesná kopie `fnv1a64` z packages/importers/src/dedupe.ts.
--
-- TypeScript iteruje po UTF-16 kódových jednotkách (`charCodeAt`), takže se
-- XORuje CELÁ kódová jednotka, ne jen její spodní bajt. Migrace 0031 tu měla
-- 8bitovou variantu s poznámkou „obsah klíče je stejně ASCII" — jenže `isin`
-- je v modelu obyčejný `z.string().min(1)`, takže si uživatel může přes
-- univerzální šablonu zapsat instrument s diakritikou a klíč z databáze by se
-- pak s tím z importéru NIKDY neshodl (ověřeno: „ČEZ“ dalo v SQL
-- fd9951c9f91c3b29, v TS 289d2c8e5382a529). Šestnáct bitů pokrývá celé BMP,
-- tedy všechno, co jde do těchhle polí rozumně napsat; znaky mimo BMP
-- (emoji, surrogate páry) by se rozešly i v `length()`/`substr()` a v ISINu
-- nedávají smysl. Shodu s TS hlídá test v apps/web/test/dedupe-migration.test.ts.
CREATE OR REPLACE FUNCTION danero_fnv1a64(input text) RETURNS text AS $$
DECLARE
  hash numeric := 14695981039346656037;   -- 0xcbf29ce484222325
  prime numeric := 1099511628211;         -- 0x100000001b3
  modulo numeric := 18446744073709551616; -- 2^64
  i int;
BEGIN
  FOR i IN 1..length(input) LOOP
    hash := (hash - (hash % 65536)) + ((hash % 65536)::int # ascii(substr(input, i, 1)));
    hash := (hash * prime) % modulo;
  END LOOP;
  -- 64bit hodnota se do `bigint` nevejde (přetéká přes 2^63−1), takže se hex
  -- skládá ze dvou 32bitových půlek
  RETURN lpad(to_hex(div(hash, 4294967296)::bigint), 8, '0')
      || lpad(to_hex((hash % 4294967296)::bigint), 8, '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint

-- Peněžní pole z payloadu: TypeScript skládá klíč z `Decimal.toString()`,
-- ale do JSONu se hodnota serializuje přes `Decimal.toJSON()` — a ty dvě se
-- liší v jediné věci: toJSON drží znaménko u nuly („-0"). Bez srovnání by se
-- klíč takového řádku rozešel s tím, co spočítá importér.
CREATE OR REPLACE FUNCTION danero_money(input text) RETURNS text AS $$
  SELECT CASE WHEN input = '-0' THEN '0' ELSE coalesce(input, '') END;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

UPDATE transactions AS t
SET dedupe_key = n.novy_klic
FROM (
  SELECT
    user_id,
    dedupe_key,
    broker || '|' || danero_fnv1a64(obsah) || '|'
      || row_number() OVER (PARTITION BY user_id, broker, obsah ORDER BY dedupe_key) AS novy_klic
  FROM (
    SELECT
      user_id,
      dedupe_key,
      broker,
      -- pořadí polí MUSÍ doslova odpovídat `contentParts` v importérech
      CASE
        WHEN payload ->> 'type' IN ('BUY', 'SELL') THEN concat_ws(
          '|',
          payload ->> 'type',
          coalesce(payload ->> 'isin', ''),
          coalesce(payload ->> 'tradeDate', ''),
          danero_money(payload ->> 'quantity'),
          danero_money(payload ->> 'pricePerShare'),
          coalesce(payload ->> 'currency', '')
        )
        WHEN payload ->> 'type' = 'DIVIDEND' THEN concat_ws(
          '|',
          'DIVIDEND',
          coalesce(payload ->> 'isin', ''),
          coalesce(payload ->> 'date', ''),
          danero_money(payload ->> 'gross'),
          danero_money(payload ->> 'withholdingTax'),
          coalesce(payload ->> 'currency', '')
        )
        WHEN payload ->> 'type' IN ('INTEREST', 'FEE', 'DEPOSIT', 'WITHDRAWAL') THEN concat_ws(
          '|',
          payload ->> 'type',
          coalesce(payload ->> 'date', ''),
          danero_money(payload ->> 'amount'),
          coalesce(payload ->> 'currency', '')
        )
        WHEN payload ->> 'type' = 'FX_CONVERSION' THEN concat_ws(
          '|',
          'FX_CONVERSION',
          coalesce(payload ->> 'date', ''),
          danero_money(payload ->> 'fromAmount'),
          coalesce(payload ->> 'fromCurrency', ''),
          danero_money(payload ->> 'toAmount'),
          coalesce(payload ->> 'toCurrency', '')
        )
        WHEN payload ->> 'type' = 'CORPORATE_ACTION' THEN concat_ws(
          '|',
          'CORPORATE_ACTION',
          coalesce(payload ->> 'subtype', ''),
          coalesce(payload ->> 'isin', ''),
          coalesce(payload ->> 'date', ''),
          coalesce(payload ->> 'newIsin', '')
        )
        WHEN payload ->> 'type' IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN concat_ws(
          '|',
          payload ->> 'type',
          coalesce(payload ->> 'isin', ''),
          coalesce(payload ->> 'date', ''),
          danero_money(payload ->> 'quantity')
        )
      END AS obsah
    FROM transactions
    -- JEN staré klíče `<broker>|<otisk>` (jedna svislítka). Řádky, které už nový
    -- tvar mají, se nesmí přečíslovat: `ORDER BY dedupe_key` je textové, takže
    -- pořadí 10 leží mezi 1 a 2 — druhý běh migrace by řádku s pořadím 10 přidělil
    -- 2 a narazil na primární klíč řádku, který 2 zrovna má. Ověřeno na ostrém
    -- Postgresu (PGlite to neukázalo, protože tam byl v tabulce jen fixture).
    WHERE dedupe_key NOT LIKE '%|%|%'
  ) s
  -- neznámý typ (jiná verze modelu) radši nechat na starém klíči než ho
  -- přepsat na NULL a shodit celou migraci
  WHERE obsah IS NOT NULL
) n
WHERE t.user_id = n.user_id AND t.dedupe_key = n.dedupe_key;--> statement-breakpoint

DROP FUNCTION danero_money(text);--> statement-breakpoint
DROP FUNCTION danero_fnv1a64(text);
