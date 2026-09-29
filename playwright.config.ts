import { defineConfig, devices } from "@playwright/test";

const webPort = 4173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "web",
      testMatch: /web\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        baseURL: `http://127.0.0.1:${webPort}`,
      },
    },
    {
      name: "desktop",
      testMatch: /desktop\.spec\.ts/,
      timeout: 60_000,
    },
  ],
  webServer: process.env["E2E_SKIP_WEB"]
    ? undefined
    : {
        command: `bunx vite dev --host 127.0.0.1 --port ${webPort} --strictPort`,
        url: `http://127.0.0.1:${webPort}`,
        reuseExistingServer: !process.env["CI"],
        timeout: 120_000,
      },
});
