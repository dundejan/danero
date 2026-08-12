-- R-07h: vratka kapitálu (return of capital) může místo zdanění snižovat
-- nabývací cenu pozice. Default false = bezpečný výklad, tedy dosavadní
-- chování — migrace nikomu nemění už spočítaná čísla.
ALTER TABLE "taxpayer_profiles" ADD COLUMN IF NOT EXISTS "return_of_capital_reduces_basis" boolean DEFAULT false NOT NULL;