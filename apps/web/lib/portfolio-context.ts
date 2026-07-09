import { and, asc, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { Db } from '@/db';
import { portfolios } from '@/db/schema';

/**
 * Aktivní portfolio (G8c): jeden účet může vést oddělená portfolia
 * (manžel/ka, děti). Výběr drží cookie; VŽDY se validuje vlastnictví
 * (tenancy = userId + portfolioId v každém dotazu). Bez cookie / po smazání
 * se použije nejstarší portfolio; nové účty ho dostanou automaticky.
 */
export const PORTFOLIO_COOKIE = 'danero-portfolio';

export type PortfolioRow = typeof portfolios.$inferSelect;

export async function listPortfolios(db: Db, userId: string): Promise<PortfolioRow[]> {
  return db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .orderBy(asc(portfolios.createdAt), asc(portfolios.id));
}

/** Zajistí aspoň jedno portfolio (migrace pokrývá stávající, tohle nové účty). */
export async function ensureDefaultPortfolio(db: Db, userId: string): Promise<PortfolioRow> {
  const existing = await listPortfolios(db, userId);
  if (existing.length > 0) return existing[0]!;
  const [created] = await db
    .insert(portfolios)
    .values({ id: `pf-${userId}`, userId, name: 'Moje portfolio' })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  return (await listPortfolios(db, userId))[0]!;
}

/** Aktivní portfolio dle cookie s validací vlastnictví; fallback = výchozí. */
export async function activePortfolio(db: Db, userId: string): Promise<PortfolioRow> {
  const jar = await cookies();
  const selectedId = jar.get(PORTFOLIO_COOKIE)?.value;
  if (selectedId) {
    const [match] = await db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.userId, userId), eq(portfolios.id, selectedId)));
    if (match) return match;
  }
  return ensureDefaultPortfolio(db, userId);
}

/**
 * Portfolio z formuláře s validací vlastnictví — cookie se mezi otevřením
 * formuláře a submitem mohla přepnout (jiný tab), formulář je zdroj pravdy.
 * Bez pole ve formuláři spadne na aktivní portfolio.
 */
export async function portfolioFromForm(
  db: Db,
  userId: string,
  formData: FormData,
): Promise<PortfolioRow> {
  const requested = String(formData.get('portfolioId') ?? '');
  if (requested) {
    const owned = await listPortfolios(db, userId);
    const match = owned.find((p) => p.id === requested);
    if (match) return match;
  }
  return activePortfolio(db, userId);
}
