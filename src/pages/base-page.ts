/**
 * Optional base class for page objects. It holds the page and its URL and
 * provides navigation plus an explicit readiness wait. Use Playwright's own
 * Page, Locator and web-first assertions for everything else.
 */

import type { Locator, Page } from "@playwright/test";
import { waitForVisible } from "../readiness/wait-for-visible";

export abstract class BasePage {
  protected page: Page;
  protected url: string;

  constructor(page: Page, url = "") {
    this.page = page;
    this.url = url;
  }

  /**
   * Navigate to the page. Waits for `domcontentloaded` only; it does not
   * establish application readiness. Follow it with `waitForReady`.
   */
  async goto(): Promise<void> {
    await this.page.goto(this.url, { waitUntil: "domcontentloaded" });
  }

  /** Wait for a caller-selected visible application state. */
  async waitForReady(locator: Locator, timeout = 10000): Promise<void> {
    await waitForVisible(locator, timeout);
  }
}
