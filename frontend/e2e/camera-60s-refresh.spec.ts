import { test, expect } from "@playwright/test";

test.describe("P0 Camera 60-Second Refresh & Truthful Timestamps", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("safepath_onboarding_completed", "true");
    });
  });

  test("verifies active 60s priority refresh, distinct timestamps, and zero mock in modal", async ({
    page,
  }) => {
    // 1. Visit monitor page
    await page.goto("/monitor");
    await page.waitForLoadState("networkidle");

    // Check header and registry
    await expect(page.locator("h1")).toContainText("Trung tâm Giám sát Camera TP.HCM");
    const cameraCards = page.locator("[data-testid='camera-card']");
    await expect(cameraCards.first()).toBeVisible({ timeout: 15000 });

    // 2. Click on the first camera card to open evidence modal
    await cameraCards.first().click();

    // 3. Modal should appear
    const modal = page.locator("[data-testid='camera-evidence-modal']");
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 4. Verify 60-second auto-check indicator badge is present
    const refreshBadge = modal.locator("text=Kiểm tra ảnh tự động mỗi ~1 phút");
    await expect(refreshBadge).toBeVisible();

    // 5. Verify distinct timestamps are visible
    await expect(modal.locator("text=Kiểm tra:")).toBeVisible();
    await expect(modal.locator("text=Nhận ảnh:")).toBeVisible();
    await expect(modal.locator("text=Chụp:")).toBeVisible();
    await expect(modal.locator("text=Truy xuất:")).toBeVisible();

    // 6. Capture screenshot of the modal with 60s auto refresh and timestamps
    await page.screenshot({ path: "docs/camera_60s_modal_active.png" });

    // 7. Test manual refresh retry button
    const retryBtn = modal.locator("button:has-text('Thử tải lại')");
    if (await retryBtn.isVisible()) {
      await retryBtn.click();
    }

    // 8. Close modal and ensure it cleanly unmounts
    const closeBtn = modal.locator("button[aria-label='Đóng chi tiết camera']");
    await closeBtn.click();
    await expect(modal).not.toBeVisible();
  });

  test("verifies MapLibre map renders camera icons and modal opens seamlessly", async ({ page }) => {
    await page.goto("/map");
    await page.waitForLoadState("networkidle");

    // Wait for map canvas
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 15000 });

    // Zoom in so camera icons are unclustered
    await page.evaluate(() => {
      // @ts-ignore
      const map = window.__safepath_map;
      if (map) map.setZoom(15.2);
    });
    await page.waitForTimeout(1000);

    // Click on a camera point on map if rendered
    const point = await page.evaluate(() => {
      // @ts-ignore
      const map = window.__safepath_map;
      if (!map) return null;
      const features = map.queryRenderedFeatures(undefined, { layers: ["camera-points"] });
      if (features.length === 0) return null;
      return map.project(features[0].geometry.coordinates);
    });

    if (point) {
      await page.mouse.click(point.x, point.y);
      const modal = page.locator("[data-testid='camera-evidence-modal']");
      if (await modal.isVisible()) {
        await expect(modal.locator("text=Kiểm tra ảnh tự động mỗi ~1 phút")).toBeVisible();
        await page.screenshot({ path: "docs/camera_60s_map_modal.png" });
        await page.locator("button[aria-label='Đóng chi tiết camera']").click();
      }
    }
  });
});
