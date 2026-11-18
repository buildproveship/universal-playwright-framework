# Authoring styles

How to organise browser tests written against this framework. The one starter
is the [private starter v1](private-starter-v1.md) in `starter/`; it creates a
project whose demo uses the Page Objects style below.

## Choose organization independently from syntax

Choose the smallest structure that helps the team:

| Organization                                           | Use when                                                     | Shape                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Simple                                                 | A short test is easiest to read with locators inline         | Playwright `page` and locators directly in the test or step                                          |
| Page Objects + Components (recommended starting point) | Pages and repeated UI regions benefit from named operations  | A page class extending `BasePage`, regions extending `BaseComponent` (starter: `pages/demo-page.ts`) |
| Business Flows                                         | A repeated business operation spans reusable page operations | A plain class composed from page objects, with no further inheritance layer                          |

These are organization choices, not different languages or execution permissions.
TypeScript Playwright Test specs and Gherkin scenarios with TypeScript Cucumber step
implementations can each use any of these structures. There is no keyword DSL.
`BasePage` and `BaseComponent` are optional; flows use composition, not deep
inheritance.

```ts
import { expect, type Page } from "@playwright/test";
import { BasePage, BaseComponent } from "@releaseready/playwright-framework";

class DraftEditor extends BaseComponent {
  constructor(page: Page) {
    super(page, 'form[aria-label="Draft editor"]');
  }
  async save(title: string): Promise<void> {
    await this.rootLocator
      .getByRole("textbox", { name: "Title", exact: true })
      .fill(title);
    await this.rootLocator
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
  }
}

class DraftPage extends BasePage {
  readonly editor = new DraftEditor(this.page);
  readonly status = this.page.getByRole("status");
  async open(): Promise<void> {
    await this.goto();
    await this.waitForReady(
      this.page.getByRole("form", { name: "Draft editor", exact: true }),
    );
  }
}

// Business Flow: composition over the page, asserting the business outcome.
class DraftFlow {
  constructor(private readonly drafts: DraftPage) {}
  async createDraft(title: string): Promise<void> {
    await this.drafts.open();
    await this.drafts.editor.save(title);
    await expect(this.drafts.status).toHaveText(`Saved: ${title}`);
  }
}
```

## Gherkin step convention for Page Objects

For Page Object steps, use one consistent convention: **action or expected state +
named field/control + `on the <Page name> Screen`**. Every Page Object step,
including setup and assertions, ends with the concrete screen name. Parameterize
entered/expected values; keep control names bound to specific page/component
methods. For example:

```gherkin
When I enter "Synthetic rehearsal" in the "Title" field on the Draft Screen
And I click the "Save draft" button on the Draft Screen
Then the status message shows "Saved: Synthetic rehearsal" on the Draft Screen
And the "Drafts" list contains only "Synthetic rehearsal" on the Draft Screen
```

Reuse these bindings for different values on the same screen. Add screen-specific
bindings for other pages rather than mapping arbitrary strings to locators. Simple
and Business Flows keep their own organization; the screen convention applies to
Page Object scenarios, including any Background steps they inherit.

## Lifecycle and data

Playwright creates a fresh browser context and page per test and retry; compose
pages, components, flows and test data as **test-scoped** fixtures (the starter's
`fixtures/demo.ts` is one). In Cucumber, create a fresh World, browser context and
page per scenario, close them in an `After` hook and reuse the same runner-neutral
page, component and flow classes. Keep deterministic data builders test-scoped and
return fresh values on every call. A builder is not a uniqueness guarantee for a
shared remote service; records in a shared service need a separate authorised
setup and cleanup design.

## Readiness and compatibility

`waitForVisible(locator, timeout = 10000)` is exported from the package root and
works without a base class. `BasePage.waitForReady(locator, timeout)` delegates to it.
Select a specific visible app state; timeouts must be finite, positive and at most
120000 ms. Missing, hidden or ambiguous locators fail rather than returning success.
For enabled state, exact text, counts and other conditions, prefer Playwright's
web-first assertions with an explicit timeout.

`BasePage.goto()` requests `domcontentloaded`, not the full load event or network idle.
It **does not promise application readiness**: follow it with `waitForReady` on the
actual UI condition. No universal ready selector is inferred. `BasePage` and
`BaseComponent` only hold the page, URL and root locator; use Playwright's own
Page and Locator API for actions.

```ts
await page.goto(url, { waitUntil: "domcontentloaded" });
await waitForVisible(
  page.getByRole("form", { name: "Draft editor", exact: true }),
  10000,
);
await page
  .getByRole("textbox", { name: "Title", exact: true })
  .fill(draft.title);
await page.getByRole("button", { name: "Save draft", exact: true }).click();
await expect(page.getByRole("status")).toHaveText(`Saved: ${draft.title}`);
```

A visible form or status alone is not proof of business success: assert the exact
outcome after each action. `tests/readiness/` holds the framework's own tests of
this behaviour (`npm run test:readiness`): delayed UI, ongoing traffic, missing and
hidden state failures, invalid timeout rejection, false-pass prevention and fresh
storage and data per test.

Portal style selection, arbitrary code upload, AI generation and leased data are
not provided.
