// ESLint flat config. The rule set comes from the shared @releaseready/config package; local additions carry
// their reason. TypeScript (`.mts`) rather than JavaScript because this repository forbids authored JavaScript
// (scripts/check-typescript-source-policy.ts); ESLint loads it through jiti.
import { releaseready } from "@releaseready/config/eslint";
import playwright from "eslint-plugin-playwright";
import { defineConfig } from "eslint/config";

export default defineConfig(
  releaseready({
    tsconfigRootDir: import.meta.dirname,
    // The project service only finds files named tsconfig.json; the Cucumber build, the readiness tests, the
    // private starter templates and this config each have their own program.
    project: [
      "./tsconfig.json",
      "./tsconfig.cucumber.json",
      "./tsconfig.tools.json",
      "./tests/readiness/tsconfig.json",
      "./starter/tsconfig.json",
    ],
  }),
  {
    // This repository is a Playwright test framework: its readiness and starter specs follow the Playwright rules.
    files: ["tests/**/*.spec.ts", "starter/templates/**/*.spec.ts"],
    extends: [playwright.configs["flat/recommended"]],
  },
  {
    // The private starter templates are the owner-approved v1 bytes (RRDWEB-34).
    // Style-only changes to them need a new approval, so this layout rule waits.
    files: ["starter/templates/**/*.spec.ts"],
    rules: { "playwright/consistent-spacing-between-blocks": "off" },
  },
);
