/**
 * Optional base class for reusable UI components. It scopes locators to one
 * root element; use Playwright's Locator API and web-first assertions on it.
 */

import type { Locator, Page } from "@playwright/test";

export abstract class BaseComponent {
  protected page: Page;
  protected rootLocator: Locator;

  constructor(page: Page, rootSelector: string) {
    this.page = page;
    this.rootLocator = page.locator(rootSelector);
  }
}
