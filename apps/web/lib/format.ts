import type { Money } from '@danero/shared';

const czkFormat = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
});

const numberFormat = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 4 });

export const czk = (value: Money | number): string =>
  czkFormat.format(typeof value === 'number' ? value : value.toNumber());

export const qty = (value: Money | number): string =>
  numberFormat.format(typeof value === 'number' ? value : value.toNumber());

export const czDate = (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString('cs-CZ');
