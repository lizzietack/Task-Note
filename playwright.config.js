import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5174', channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true, viewport: { width: 1365, height: 900 } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort --open false', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://daymark-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' } },
});
