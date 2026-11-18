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
