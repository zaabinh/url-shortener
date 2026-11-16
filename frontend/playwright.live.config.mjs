import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e-live',
    workers: 1,
    use: {
        baseURL: process.env.PLAYWRIGHT_LIVE_BASE_URL || 'http://localhost:3000',
        browserName: 'chromium',
    },
});
