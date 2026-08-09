-- C-3-02: reklamace platby (chargeback) zamykala předplatné jen v naší databázi,
-- zatímco ve Stripe běželo dál — a denní rekonciliace ho podle Stripe zase
-- odemkla. Ochrana tak vydržela nanejvýš do 3:40 ráno. Řádek teď nese důvod,
-- proč jsme přístup odebrali my; rekonciliace ho pak nepřepisuje, jen loguje.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "revoked_reason" text;
