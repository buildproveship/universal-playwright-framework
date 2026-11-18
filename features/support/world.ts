// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Cucumber world shared by the owned synthetic scenarios; holds the browser, page and local base URL only.
import type { Browser, Page } from "@playwright/test";

export interface SyntheticWorld {
  browser: Browser;
  baseUrl: string;
  page?: Page;
}

/** The page the Before hook opened; a step that runs without one fails with a clear message. */
export function openPage(world: SyntheticWorld): Page {
  if (!world.page)
    throw new Error("No page is open; the Before hook opens one");
  return world.page;
}
