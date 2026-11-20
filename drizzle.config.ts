import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env, .env.local, etc. the same way Next.js does, so drizzle-kit
// and the app always point at the same database.
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
