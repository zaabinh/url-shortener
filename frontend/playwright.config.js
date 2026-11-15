import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    reporter: 'list',
    workers: process.env.CI ? 2 : undefined,
    webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
        command: 'python -m http.server 8080 --bind 127.0.0.1 --directory out',
        url: 'http://127.0.0.1:8080',
        reuseExistingServer: !process.env.CI,
    },
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8080',
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
    },
});
