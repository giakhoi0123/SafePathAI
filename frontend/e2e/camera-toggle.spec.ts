import { test, expect } from "@playwright/test";

test.describe("Camera Toggle & Evidence Modal Live E2E", () => {
  test("toggles camera visibility, expands clusters, and clicks marker to open truthful evidence modal", async ({
    page,
  }) => {
    await page.goto("/");

    // 1. Map container loads
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 15000 });
    const mapContainer = page.locator("[data-testid='route-map']");
    await expect(mapContainer).toBeVisible();

    // 2. Camera toggle switch is visible and active by default
    const cameraSwitch = page.getByRole("switch", { name: "Hiển thị camera" });
    await expect(cameraSwitch).toBeVisible();
    await expect(cameraSwitch).toHaveAttribute("aria-checked", "true");

    // 3. Markers populated from /api/v1/cameras (real HCMC cameras in viewport)
    await expect(mapContainer).toHaveAttribute("data-camera-feature-count", /^[1-9]\d*$/, { timeout: 10000 });
    const count = parseInt((await mapContainer.getAttribute("data-camera-feature-count")) || "0", 10);
    expect(count).toBeGreaterThan(0);

    // 4. Toggle OFF -> layer cleared
    await cameraSwitch.click();
    await expect(cameraSwitch).toHaveAttribute("aria-checked", "false");
    await expect(mapContainer).toHaveAttribute("data-camera-feature-count", "0");

    // 5. Toggle ON -> layer restored
    await cameraSwitch.click();
    await expect(cameraSwitch).toHaveAttribute("aria-checked", "true");
    await expect(mapContainer).toHaveAttribute("data-camera-feature-count", /^[1-9]\d*$/);

    // 6. Click camera point on the map canvas to trigger CameraEvidenceModal
    // Zoom in closer to uncluster markers
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(600);

    // Get pixel position of first unclustered camera point on the canvas
    const clickPoint = await page.evaluate(() => {
      // @ts-ignore
      const map = window.__safepath_map;
      if (!map) return null;
      const features = map.queryRenderedFeatures({ layers: ["camera-points"] });
      if (!features || features.length === 0) return null;
      const geom = features[0].geometry;
      if (geom.type !== "Point") return null;
      const [lng, lat] = geom.coordinates;
      const pixel = map.project([lng, lat]);
      const canvasRect = map.getCanvas().getBoundingClientRect();
      return {
        x: canvasRect.left + pixel.x,
        y: canvasRect.top + pixel.y,
        camId: features[0].properties?.id,
        camCode: features[0].properties?.label,
      };
    });

    if (clickPoint) {
      await page.mouse.click(clickPoint.x, clickPoint.y);

      // Verify CameraEvidenceModal appears
      const modal = page.locator(".glass-panel-elevated").filter({ hasText: "Ảnh Snapshot Trực Tiếp" });
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Verify truthful evidence fields (no fake AI badges)
      await expect(modal.getByText(/CHƯA XÁC MINH|RỦI RO|AN TOÀN/)).toBeVisible();
      await expect(modal.getByText(/Nguồn:|Trạng thái kết nối:/)).toBeVisible();

      // Close modal
      const closeBtn = modal.locator("button").first();
      await closeBtn.click();
      await expect(modal).not.toBeVisible();
    }
  });
});

