import { test as base, expect } from "@playwright/test";
import { installOwnedApp } from "./owned-app";
import { buildDraft, type DraftData } from "./data";
import { DraftPage } from "./draft-page";

export { appUrl } from "./owned-app";
interface Fixtures {
  ownedApp: { url: string; trafficRequests: () => number };
  draft: DraftData;
  drafts: DraftPage;
}

// Playwright owns a fresh page/context for every test, including retries.
export const test = base.extend<Fixtures>({
  ownedApp: async ({ page }, use) => {
    await use(await installOwnedApp(page.context()));
  },
  // Playwright requires destructuring even for a fixture with no dependencies.
  // eslint-disable-next-line no-empty-pattern
  draft: async ({}, use) => {
    await use(buildDraft());
  },
  drafts: async ({ page, ownedApp }, use) => {
    await use(new DraftPage(page, ownedApp.url));
  },
});

export { expect };
