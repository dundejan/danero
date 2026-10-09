// Mutační testy daňového jádra (Stryker + Vitest): `pnpm test:mutation`.
// Běží týdně a ručně ve workflow mutation.yml — na každý push je to moc pomalé.
// Práh (`thresholds.break`) schválně chybí: nejdřív je potřeba vytřídit
// přeživší mutanty, teprve pak má smysl hlídat propad skóre.
// Výstupní adresář jde přepsat proměnnou STRYKER_OUT.
const out = process.env.STRYKER_OUT ?? 'reports/mutation';

export default {
  testRunner: 'vitest',
  // pnpm: pluginy se samy nenajdou, musí být vyjmenované
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.stryker.config.ts' },
  mutate: [
    'packages/engine/src/**/*.ts',
    'packages/shared/src/**/*.ts',
    // jen re-exporty, nic k mutování
    '!packages/*/src/index.ts',
  ],
  // do pískoviště jen to, co testy potřebují
  ignorePatterns: [
    'apps',
    'docs',
    'scripts',
    'packages/importers',
    '.data',
    '.next*',
    'dist',
    'reports',
    '.github',
  ],
  coverageAnalysis: 'perTest',
  // statický mutant (tabulka kurzů, svátky, schéma modelu) spouští celou sadu —
  // jen těch 164 by trvalo déle než všechno ostatní dohromady
  ignoreStatic: true,
  concurrency: 3,
  timeoutMS: 3000,
  reporters: ['json', 'clear-text', 'progress'],
  jsonReporter: { fileName: `${out}/mutation.json` },
  clearTextReporter: { allowColor: false, logTests: false, reportTests: false },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
