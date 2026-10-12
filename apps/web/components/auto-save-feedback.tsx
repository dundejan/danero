'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { Toast } from '@/components/toast';
import {
  currentFeedback,
  dismissFeedback,
  feedbackIsFor,
  refreshSettled,
  setRefresher,
  subscribeToFeedback,
} from '@/lib/save-feedback';

const noFeedback = (): null => null;

/**
 * Potvrzení a chyby automatického ukládání (`lib/save-feedback.ts`). Stojí
 * v rozložení aplikace, ne na stránce s formulářem: částka rozepsaná při
 * odchodu z Nastavení se ukládá, až když je člověk jinde, a výsledek se má
 * dozvědět tam.
 *
 * `owner` je označení přihlášeného účtu (`lib/owner-tag.ts`): hláška z formuláře
 * jiného účtu, který byl v panelu přihlášený předtím, se neukáže. Hláška, která
 * z obrazovky odešla, se z úložiště maže — jinak ji každý návrat do aplikace
 * ukázal znovu.
 */
export function AutoSaveFeedback({ owner }: { owner: string }) {
  const router = useRouter();
  const feedback = useSyncExternalStore(subscribeToFeedback, currentFeedback, noFeedback);
  const [mountedAt] = useState(() => Date.now());
  // dotažení stránky jako přechod: `refreshing` spadne, až je nový stav na obrazovce
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    setRefresher(() => startRefresh(() => router.refresh()));
    return () => setRefresher(null);
  }, [router]);
  useEffect(() => {
    if (!refreshing) refreshSettled();
  }, [refreshing]);

  const shown = feedback !== null && feedbackIsFor(feedback, owner, mountedAt);
  const staleId = feedback !== null && !shown ? feedback.id : null;
  useEffect(() => {
    if (staleId !== null) dismissFeedback(staleId);
  }, [staleId]);

  if (!feedback || !shown) return null;
  return (
    <Toast
      key={feedback.id}
      kind={feedback.kind}
      text={feedback.text}
      floating
      onGone={() => dismissFeedback(feedback.id)}
    />
  );
}
