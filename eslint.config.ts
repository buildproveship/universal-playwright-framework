import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import playwright from "eslint-plugin-playwright";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "reports/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Destructuring a key away to omit it from the rest object is intended.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
      // `import x = require()` keeps the mutable CommonJS module object that
      // node:test mocks need; plain `require()` calls stay forbidden.
      "@typescript-eslint/no-require-imports": [
        "error",
        { allowAsImport: true },
      ],
    },
  },
  {
    files: ["tests/**/*.spec.ts", "starter/templates/**/*.spec.ts"],
    ...playwright.configs["flat/recommended"],
  },
  {
    // The private starter templates are the owner-approved v1 bytes (RRDWEB-34).
    // Style-only changes to them need a new approval, so this layout rule waits.
    files: ["starter/templates/**/*.spec.ts"],
    rules: { "playwright/consistent-spacing-between-blocks": "off" },
  },
  prettier,
);
