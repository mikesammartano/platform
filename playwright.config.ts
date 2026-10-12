import { defineConfig } from '@playwright/test';

/** End-to-end checks of every teacher tool against the dev server (WebGL via SwiftShader in CI). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1920, height: 1080 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'npm run dev -- --port 5173 --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
