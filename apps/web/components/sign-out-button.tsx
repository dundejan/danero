'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { attemptSignOut } from '@/lib/sign-out';

/**
 * Odhlášení s ošetřeným neúspěchem (L12-04): na přihlášení se jde až po
 * potvrzeném odhlášení. Když server odpoví chybou nebo spadne síť, zůstane
 * uživatel na stránce a `error` nese hlášku, že přihlášení trvá.
 */
function useSignOut(): { signOut: () => void; error: string | null } {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const signOut = () => {
    setError(null);
    // attemptSignOut nevyhazuje (výjimku sítě vrací jako neúspěch), takže
    // tenhle řetěz nemůže skončit neošetřeným odmítnutím
    void attemptSignOut(() => authClient.signOut()).then((outcome) => {
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      router.push(outcome.redirectTo);
      router.refresh();
    });
  };
  return { signOut, error };
}

/**
 * Tlačítko „Odhlásit se“ i s hláškou o neúspěchu — jediné místo v aplikaci,
 * které odhlašuje.
 *
 * Do revize 5 žilo jen v patičce desktopového railu, takže na telefonu se
 * odhlásit nedalo vůbec (L7-01): relace platí 7 dní a na půjčeném zařízení ji
 * nešlo ukončit jinak než smazáním dat prohlížeče. Rail i sheet „Více“ na
 * telefonu vykreslují tuhle komponentu, ať se ošetření neúspěchu nekopíruje.
 *
 * V každé šířce okna je odhlášení právě jedno a vždy u účtu ve skořápce:
 * v patičce postranního panelu, pod ní v sheetu „Více“. Třetí tlačítko
 * v Nastavení → Účet bylo na telefonu vidět vedle toho v sheetu — dvě cesty
 * k téže věci (zrušeno 11. 10. 2026, hlídá `test/account-page-controls.test.ts`).
 *
 * Vzhled si určuje volající (v railu nenápadný text, v sheetu řádek seznamu).
 * Vrací fragment — rozestup mezi tlačítkem a hláškou drží obal volajícího.
 */
export function SignOutButton({
  className,
  errorClassName,
}: {
  className: string;
  errorClassName: string;
}) {
  const { signOut, error } = useSignOut();
  return (
    <>
      <button type="button" className={className} onClick={signOut}>
        Odhlásit se
      </button>
      {/* zůstává, dokud další pokus nedopadne jinak — neúspěšné odhlášení
          nesmí zmizet samo, uživatel by od zařízení odešel přihlášený */}
      {error && (
        <p role="alert" className={errorClassName}>
          {error}
        </p>
      )}
    </>
  );
}
