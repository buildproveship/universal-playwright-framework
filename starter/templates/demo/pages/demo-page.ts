import { BasePage } from "@buildproveship/playwright-framework";
import type { Page } from "@playwright/test";
export class DemoPage extends BasePage {
  constructor(page: Page, origin: string) {
    super(page, origin);
  }
  async confirm(): Promise<void> {
    await this.page.getByRole("button", { name: "Confirm demo" }).click();
  }
  status() {
    return this.page.getByRole("status");
  }
}
