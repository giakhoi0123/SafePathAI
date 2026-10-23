import { test, expect } from "@playwright/test";

// Live only: no page.route interception or fabricated GeoJSON.
test("OSRM route appears on the live map", async ({ page }) => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await page.request.post(`${apiBase}/api/v1/routes/search`, {
    data: {
      origin: { lat: 10.7725, lng: 106.6980 },
      destination: { lat: 10.8012, lng: 106.7115 },
    },
  });
  expect(response.status()).toBe(200);
  const route = await response.json();
  expect(route.geojson_path.type).toBe("LineString");
  expect(route.geojson_path.coordinates.length).toBeGreaterThanOrEqual(10);
  expect(route.total_distance_km).toBeGreaterThan(0);
  expect(route.estimated_time_mins).toBeGreaterThan(0);

  page.on("console", (msg) => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => console.error(`[BROWSER ERROR]`, err));

  await page.goto("/");
  await expect(page.getByText("Tuyến đang chọn")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.locator("[data-route-vertices]")).toHaveAttribute("data-route-vertices", /^\d{2,}$/);
  await expect(page.locator("[data-tiles-ready='true']")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Không tải được bản đồ.")).toHaveCount(0);
  await expect(page.locator(".maplibregl-marker").filter({ hasText: /^A$/ })).toBeVisible();
  await expect(page.locator(".maplibregl-marker").filter({ hasText: /^B$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenFreeMap" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
  await page.screenshot({ path: "test-results/osrm-live-map-primary.png", fullPage: true });
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/osrm-live-map-detail.png", fullPage: true });
  const candidateButton = page.getByRole("button", { name: "Chọn tuyến này" }).first();
  if (await candidateButton.count()) {
    await candidateButton.click();
    await expect(page.getByText("Tuyến đang chọn")).toBeVisible();
    await expect(page.locator("[data-route-vertices]")).toHaveAttribute("data-route-vertices", /^\d{2,}$/);
    await page.screenshot({ path: "test-results/osrm-live-map-alternative.png", fullPage: true });
  }
});

test("five independent HCMC pairs render real routes on tiles", async ({ page }) => {
  await page.goto("/");
  const pairs = [
    ["Chợ Bến Thành (Quận 1)", "Ngã tư Hàng Xanh (Bình Thạnh)"],
    ["Sân bay Tân Sơn Nhất", "Chợ Bến Thành (Quận 1)"],
    ["Landmark 81 (Bình Thạnh)", "Ngã tư Hàng Xanh (Bình Thạnh)"],
    ["Nhà thờ Đức Bà (Quận 1)", "Landmark 81 (Bình Thạnh)"],
    ["Đường Nguyễn Hữu Cảnh", "Sân bay Tân Sơn Nhất"],
  ];
  for (let index = 0; index < pairs.length; index++) {
    const [origin, destination] = pairs[index];
    await page.getByRole("combobox").nth(0).selectOption({ label: origin });
    await page.getByRole("combobox").nth(1).selectOption({ label: destination });
    await page.getByRole("button", { name: "Tìm tuyến đường OSM" }).click();
    await expect(page.getByText("Tuyến đang chọn")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-route-vertices]")).toHaveAttribute("data-route-vertices", /^\d{2,}$/);
    await expect(page.locator("[data-tiles-ready='true']")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Không tải được bản đồ.")).toHaveCount(0);
    await page.screenshot({ path: `test-results/osrm-hcm-pair-${index + 1}.png`, fullPage: true });
  }
});
