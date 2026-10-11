'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ClearFeedbackUrl } from '@/components/clear-feedback-url';
import { buttonVariants } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';

/** Výsledek nahrání nebo vrácení importu tak, jak ho stránka složila z adresy. */
export interface UploadResult {
  kind: 'ok' | 'chyba';
  text: string;
  /** Po prvních datech účtu (a bez chyb) hláška nabídne přehled. */
  offerOverview: boolean;
}

/**
 * Poslední ukázaný výsledek. Proměnná modulu, ne stav komponenty: obnovení
 * stránky po doběhu synchronizace ji vykreslí celou znovu (adresa se mezitím
 * změnila úklidem) a stav komponenty by s ní zanikl.
 */
let kept: UploadResult | null = null;
let forgetTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Výsledek nahrání a vrácení importu nad historií — hláška, která nemizí sama.
 *
 * Text nese adresa (`?ulozeno=nahrano&…`) a `ClearFeedbackUrl` ho z ní hned
 * uklidí, aby ho obnovení stránky ani tlačítko zpět neukázalo znovu. Jenže
 * stránka se umí obnovit i sama: když doběhne synchronizace, načte se ze
 * serveru znovu — už bez parametrů — a hláška i s dalším krokem zmizela
 * uprostřed čtení (nález revize R6). Proto si ji drží prohlížeč: zůstává,
 * dokud uživatel neodejde, stránku nenačte znovu nebo neudělá další akci
 * (`otherFeedback` — adresa nese jiný výsledek, ten starý už neplatí).
 */
export function UploadResultNotice({
  result,
  otherFeedback,
}: {
  /** Výsledek z adresy; `null`, když ho adresa (už) nenese. */
  result: UploadResult | null;
  /** Adresa nese výsledek jiné akce (připojení, odpojení, chyba…). */
  otherFeedback: boolean;
}) {
  const shown = result ?? (otherFeedback ? null : kept);
  useEffect(() => {
    // nové vykreslení téže stránky přišlo dřív, než se stihlo zapomenout
    clearTimeout(forgetTimer);
    kept = shown;
    return () => {
      // odchod ze stránky: nové vykreslení už nepřijde a hláška se zapomene
      forgetTimer = setTimeout(() => {
        kept = null;
      }, 0);
    };
  }, [shown]);

  if (!shown) return null;
  return (
    <>
      {result && <ClearFeedbackUrl />}
      <Notice
        className="mb-8"
        role={shown.kind === 'chyba' ? 'alert' : 'status'}
        tone={shown.kind === 'chyba' ? 'danger' : 'success'}
        title={shown.text}
        action={
          shown.offerOverview && (
            <Link href="/prehled" className={buttonVariants({ variant: 'tinted', size: 'sm' })}>
              Hotovo, otevřít přehled
            </Link>
          )
        }
      />
    </>
  );
}
