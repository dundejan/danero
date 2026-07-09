'use client';

import { usePathname } from 'next/navigation';
import { switchPortfolioAction } from '@/app/(app)/nastaveni/actions';

/**
 * Přepínač aktivního portfolia (G8c) — zobrazuje se jen s více portfolii.
 * Změna odešle server action (cookie + revalidace celého layoutu).
 */
export function PortfolioSwitcher({
  portfolios,
  activeId,
}: {
  portfolios: Array<{ id: string; name: string }>;
  activeId: string;
}) {
  const pathname = usePathname();
  if (portfolios.length <= 1) return null;
  return (
    <form action={switchPortfolioAction} className="mb-6 flex items-center gap-2">
      <input type="hidden" name="zpet" value={pathname} />
      <label htmlFor="portfolio-switch" className="text-xs font-medium text-inkoust-tlumeny">
        Portfolio
      </label>
      <select
        id="portfolio-switch"
        name="portfolioId"
        defaultValue={activeId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-linka bg-transparent px-2 py-1 text-sm font-medium"
      >
        {portfolios.map((portfolio) => (
          <option key={portfolio.id} value={portfolio.id}>
            {portfolio.name}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="rounded-md border border-linka px-2 py-1 text-sm">
          Přepnout
        </button>
      </noscript>
    </form>
  );
}
