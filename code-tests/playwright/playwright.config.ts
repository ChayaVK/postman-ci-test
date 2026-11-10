import { defineConfig } from '@playwright/test';

// API tests only: no browser is started, so no "npx playwright install" is needed.
export default defineConfig({
  testDir: './tests',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
});
