import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  workers: 1, // timing-sensitive tests; keep them from competing for CPU
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    // Real Chrome: Playwright's bundled Chromium has no H.264/AAC.
    channel: "chrome",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: [
    { command: "npm run start -w server", url: "http://localhost:3001/api/health", reuseExistingServer: !process.env.CI, cwd: ".." },
    { command: "npm run dev -w web", url: "http://localhost:5173", reuseExistingServer: true, cwd: ".." },
  ],
});
