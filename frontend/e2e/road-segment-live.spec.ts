import { test, expect } from "@playwright/test";

test("a sourced OSRM step can be highlighted without claiming an OSM Way ID", async ({ page }) => {
  await page.goto("/");
  const showStep = page.getByRole("button", { name: "Xem đoạn trên bản đồ" }).first();
  await expect(showStep).toBeVisible({ timeout: 15000 });
  await showStep.click();
  await expect(page.locator("[data-highlight-vertices]")).toHaveAttribute("data-highlight-vertices", /^\d+$/);
  await expect(page.getByText(/cạnh OSM ứng viên; ID đoạn chưa xác minh/).first()).toBeVisible();
  await expect(page.locator("[data-tiles-ready='true']")).toBeVisible();
  await page.screenshot({ path: "../docs/screenshots/phase2-step-highlight.png", fullPage: true });
  await page.getByRole("button", { name: "Ẩn đoạn trên bản đồ" }).click();
  await expect(page.locator("[data-highlight-vertices]")).toHaveCount(0);
});
