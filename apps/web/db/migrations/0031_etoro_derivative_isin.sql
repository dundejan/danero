-- A2-3-06: eToro deriváty dostaly klíč instrumentu shodný se spotovou pozicí
-- (holý ticker, u krypta dokonce sdílený napříč brokery), takže engine podle
-- „druh je vlastnost instrumentu" překlopil celou drženou pozici na derivát.
-- Doloženo: šest let držené BTC osvobozené časovým testem → daň 0 → 159 120 Kč.
--
-- Parser nově dává derivátům `CFD:<ticker>` (konvence univerzální šablony).
-- Tahle migrace srovnává už uložená data. Přepisuje se:
--   1. sloupec `transactions.isin`,
--   2. `payload->>'isin'` (z něj engine čte),
--   3. `dedupe_key` — POZOR, ten se z isinu počítá, takže bez přepočtu by se
--      tytéž řádky při dalším importu téhož výpisu uložily podruhé.

-- FNV-1a 64bit, přesná kopie `fnv1a64` z packages/importers/src/dedupe.ts.
-- Iteruje se po UTF-16 kódových jednotkách (`charCodeAt`) — obsah klíče je
-- ASCII (typ, ISIN, datum, čísla, měna, id), takže se to s `ascii()` shoduje.
-- Shodu s TS implementací hlídá test v apps/web/test/postgres-compat.test.ts.
CREATE OR REPLACE FUNCTION danero_fnv1a64(input text) RETURNS text AS $$
DECLARE
  hash numeric := 14695981039346656037;   -- 0xcbf29ce484222325
  prime numeric := 1099511628211;         -- 0x100000001b3
  modulo numeric := 18446744073709551616; -- 2^64
  i int;
BEGIN
  FOR i IN 1..length(input) LOOP
    -- XOR nejnižšího bajtu: kódy jsou < 256, takže stačí spodních 8 bitů
    hash := (hash - (hash % 256)) + ((hash % 256)::int # ascii(substr(input, i, 1)));
    hash := (hash * prime) % modulo;
  END LOOP;
  -- 64bit hodnota se do `bigint` nevejde (přetéká přes 2^63−1), takže se hex
  -- skládá ze dvou 32bitových půlek
  RETURN lpad(to_hex(div(hash, 4294967296)::bigint), 8, '0')
      || lpad(to_hex((hash % 4294967296)::bigint), 8, '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint

UPDATE transactions AS t
SET
  isin = 'CFD:' || t.isin,
  payload = jsonb_set(t.payload, '{isin}', to_jsonb('CFD:' || t.isin)),
  dedupe_key = 'etoro|' || danero_fnv1a64(
    concat_ws(
      '|',
      t.payload ->> 'type',
      'CFD:' || t.isin,
      t.payload ->> 'tradeDate',
      t.payload ->> 'quantity',
      t.payload ->> 'pricePerShare',
      t.payload ->> 'currency',
      t.payload ->> 'id'
    )
  )
WHERE t.broker = 'etoro'
  AND t.payload ->> 'assetClass' = 'DERIVATIVE'
  AND t.isin IS NOT NULL
  AND t.isin NOT LIKE 'CFD:%'
  -- dedupe klíč umíme přepočítat jen u obchodů; jiné typy transakcí eToro
  -- s derivátovou třídou nevytváří (otevření i uzavření jsou BUY/SELL)
  AND t.payload ->> 'type' IN ('BUY', 'SELL');--> statement-breakpoint
DROP FUNCTION danero_fnv1a64(text);
