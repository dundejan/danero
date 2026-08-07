-- R-05c: metoda párování zafixovaná za daňový rok, který už uživatel použil
-- pro přiznání. Chybějící řádek = platí metoda z "taxpayer_profiles".
-- Jen vytvoření tabulky (IF NOT EXISTS + constrainty inline, ať je celá migrace
-- jeden idempotentní příkaz) — žádná existující data se nečtou ani nemění.
CREATE TABLE IF NOT EXISTS "tax_year_settings" (
	"user_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"matching_method" text NOT NULL,
	"pinned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_year_settings_user_id_tax_year_pk" PRIMARY KEY("user_id","tax_year"),
	CONSTRAINT "tax_year_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);
