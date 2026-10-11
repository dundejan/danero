'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { Toast } from '@/components/toast';
import {
  currentFeedback,
  setRefresher,
  subscribeToFeedback,
} from '@/lib/save-feedback';

const noFeedback = (): null => null;

/**
 * Potvrzení a chyby automatického ukládání (`lib/save-feedback.ts`). Stojí
 * v rozložení aplikace, ne na stránce s formulářem: částka rozepsaná při
 * odchodu z Nastavení se ukládá, až když je člověk jinde, a výsledek se má
 * dozvědět tam.
 */
export function AutoSaveFeedback() {
  const router = useRouter();
  const feedback = useSyncExternalStore(subscribeToFeedback, currentFeedback, noFeedback);
  useEffect(() => {
    setRefresher(() => router.refresh());
    return () => setRefresher(null);
  }, [router]);
  if (!feedback) return null;
  return <Toast key={feedback.id} kind={feedback.kind} text={feedback.text} floating />;
}
