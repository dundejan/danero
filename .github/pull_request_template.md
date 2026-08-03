<!-- Díky za příspěvek! Zaškrtni, co platí — nehodící se klidně smaž. -->

**Co PR dělá a proč:**

---

- [ ] Commity jsou podepsané (`git commit -s`, DCO)
- [ ] **Žádná reálná data** — přiložené vzorky výpisů jsou anonymizované
      (smyšlené jméno a číslo účtu, změněné počty a částky)
- [ ] `pnpm build && pnpm typecheck && pnpm test && pnpm lint` je zelené
- [ ] Uživatelské texty (UI, chyby, e-maily) jsou česky

**Mění se daňová logika?** Pak navíc:

- [ ] Pravidlo je popsané v `docs/02-danova-pravidla.md` **se zdrojem**
      (paragraf zákona, pokyn GFŘ) a má ID R-xx
- [ ] Test na pravidlo odkazuje jeho ID
- [ ] U sporného výkladu je přepínač s **bezpečným defaultem**
