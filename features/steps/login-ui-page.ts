// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Page object for the owned synthetic login form used by the login-ui scenarios; no customer pages.
import type { Page } from "@playwright/test";
import { BasePage } from "../../src/pages/base-page";

export class SyntheticLoginPage extends BasePage {
  constructor(page: Page, url = "") {
    super(page, url);
  }

  async enterAccountName(value: string): Promise<void> {
    await this.page.getByRole("textbox", { name: "Account name" }).fill(value);
  }

  async enterPassword(value: string): Promise<void> {
    await this.page.getByRole("textbox", { name: "Password" }).fill(value);
  }

  async togglePasswordVisibility(): Promise<void> {
    const show = this.page.getByRole("button", { name: "Show password" });
    const hide = this.page.getByRole("button", { name: "Hide password" });
    await ((await hide.isVisible()) ? hide : show).click();
  }

  async submit(): Promise<void> {
    await this.page.getByRole("button", { name: "Sign in" }).click();
  }

  async submitWithEnter(): Promise<void> {
    await this.page.getByRole("textbox", { name: "Password" }).press("Enter");
  }
}
