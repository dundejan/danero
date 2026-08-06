import { describe, expect, it } from 'vitest';
import { addBusinessDays, addDays, addYears, diffDays, yearOf } from '../src/dates';

describe('dates', () => {
  it('addDays přechází přes konec měsíce a roku', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('addYears zarovná 29. 2. na poslední den měsíce (konzervativně pro R-01)', () => {
    expect(addYears('2024-02-29', 3)).toBe('2027-02-28');
    expect(addYears('2022-06-03', 3)).toBe('2025-06-03');
  });

  it('addBusinessDays přeskakuje víkend', () => {
    // 2024-05-31 je pátek → T+1 pondělí, T+2 úterý
    expect(addBusinessDays('2024-05-31', 1)).toBe('2024-06-03');
    expect(addBusinessDays('2024-05-31', 2)).toBe('2024-06-04');
  });

  it('addBusinessDays přeskakuje i svátky z předaného kalendáře (R-01a)', () => {
    // pondělí 2024-06-03 je „svátek“ → T+1 z pátku padá na úterý
    const isHoliday = (date: string): boolean => date === '2024-06-03';
    expect(addBusinessDays('2024-05-31', 1, isHoliday)).toBe('2024-06-04');
    expect(addBusinessDays('2024-05-31', 2, isHoliday)).toBe('2024-06-05');
    // bez kalendáře se chování nemění
    expect(addBusinessDays('2024-05-31', 1)).toBe('2024-06-03');
  });

  it('diffDays a yearOf', () => {
    expect(diffDays('2025-01-01', '2025-01-31')).toBe(30);
    expect(diffDays('2025-01-31', '2025-01-01')).toBe(-30);
    expect(yearOf('2025-06-03')).toBe(2025);
  });
});
