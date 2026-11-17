// Test classification: e2e
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Fixed owned loopback starter demonstration only; not customer or production acceptance. Canonical ID allocation is pending.
import { test, expect } from "../fixtures/demo.ts";

test("Given the owned demo, when I confirm, then confirmation is visible", async ({
  demo,
  page,
}, testInfo) => {
  await test.step("Given the owned synthetic demo is ready", async () => {
    await demo.goto();
    await expect(demo.status()).toHaveText("Ready");
  });
  await test.step("When I confirm the demo", async () => {
    await demo.confirm();
  });
  await test.step("Then confirmation is visible", async () => {
    await expect(demo.status()).toHaveText("Confirmed");
  });
  await testInfo.attach("owned-demo", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
