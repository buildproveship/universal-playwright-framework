// ESLint flat config. The rule set comes from the shared @buildproveship/config package; local additions carry
// their reason. TypeScript (`.mts`) rather than JavaScript because this repository forbids authored JavaScript
// (scripts/check-typescript-source-policy.ts); ESLint loads it through jiti.
import { releaseready } from "@buildproveship/config/eslint";
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
    // Guard for RRDSCRUM-375: a double cast hides a wrong type. Test doubles go through `fake()` in
    // scripts/fixtures/fake-playwright.ts, which holds the one documented cast.
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression > TSAsExpression.expression[typeAnnotation.type='TSUnknownKeyword']",
          message:
            "Do not use `as unknown as`. Use a real type or a type guard; for a test double use fake() from scripts/fixtures/fake-playwright.ts.",
        },
      ],
    },
  },
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
  // The same owner-approved template bytes (RRDWEB-34) predate the strict rule set. Each finding below is
  // style or typing only, not behaviour, so it waits for the next template approval instead of an edit
  // here; the list is in the adoption pull request. Scoped to the exact file and rule.
  {
    files: ["starter/templates/common/scripts/demo.ts"],
    rules: {
      // Untyped JSON from the demo's own output; typing only, template bytes are approved (RRDWEB-34).
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["starter/templates/demo/fixtures/demo.ts"],
    rules: {
      // Playwright fixture callbacks in the approved template (RRDWEB-34); style only, not behaviour.
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["starter/templates/demo/pages/demo-page.ts"],
    rules: { "@typescript-eslint/no-useless-constructor": "off" },
  },
);
