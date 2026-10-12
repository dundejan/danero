import { AppSkeleton } from '@/components/app-skeleton';

/**
 * Načítání stránky aplikace i dema (G9b) — kostra je v `components/app-skeleton.tsx`
 * (klientská: tvar lišty si čte z adresy, na kterou se jde).
 */
export default function AppLoading() {
  return <AppSkeleton />;
}
