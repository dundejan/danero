import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  // `drizzle-kit migrate` bez tohohle skončí na „url is required" — generování
  // migrací (`db:generate`) připojení nepotřebuje, proto smí být prázdné.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
