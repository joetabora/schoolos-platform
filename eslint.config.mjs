import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint 9 replaces `no-restricted-imports` wholesale when a later block
 * matches the same file. Every block that sets the rule therefore carries
 * the full restriction set that file should have.
 */
const pgKyselyPaths = [
  {
    name: "pg",
    message: "Only src/platform/db may import pg (ADR-0014).",
  },
  {
    name: "kysely",
    message: "Only src/platform/db may construct Kysely instances (ADR-0014).",
  },
];

const supabasePaths = [
  {
    name: "@supabase/supabase-js",
    message: "Only src/platform/auth may import the Supabase SDK (ADR-0004, ADR-0016).",
  },
  {
    name: "@supabase/ssr",
    message: "Supabase must not run in the browser. Keep it in src/platform/auth (ADR-0016).",
  },
];

const serverModulePatterns = [
  {
    group: [
      "@/platform/config/env",
      "**/platform/config/env",
      "@/platform/log/**",
      "**/platform/log/**",
      "@/platform/db/**",
      "**/platform/db/**",
    ],
    message: "UI components must not import server-only platform modules.",
  },
];

const providerPatterns = [
  {
    group: ["@/providers", "@/providers/**", "**/providers/**"],
    message: "Domain modules must not import provider adapters (ADR-0005).",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "spikes/**", "out/**"]),
  {
    files: ["**/*.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...pgKyselyPaths, ...supabasePaths],
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/platform/db/**/*.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: supabasePaths,
        },
      ],
    },
  },
  {
    files: ["src/platform/auth/**/*.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: pgKyselyPaths,
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["app/api/**", "app/status/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...pgKyselyPaths, ...supabasePaths],
          patterns: serverModulePatterns,
        },
      ],
    },
  },
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...pgKyselyPaths, ...supabasePaths],
          patterns: providerPatterns,
        },
      ],
    },
  },
]);

export default eslintConfig;
