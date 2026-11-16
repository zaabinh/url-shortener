import { test, expect } from '@playwright/test';

test('creates a URL, redirects and deletes it', async ({ page, request }) => {
    const api = (process.env.PLAYWRIGHT_LIVE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
    let code;
    const customCode = `e2e${Date.now()}`;

    try {
        await page.goto('/');
        await page.getByLabel('Paste your URL')
            .fill('https://example.com/e2e');
        await page.getByLabel('Custom short code (optional)').fill(customCode);

        const expiration = await page.evaluate(() => {
            const date = new Date(Date.now() + 86_400_000);
            return new Date(
                date.getTime() - date.getTimezoneOffset() * 60_000
            ).toISOString().slice(0, 16);
        });

        await page.getByLabel('Expiration date and time').fill(expiration);

        const createdResponse = page.waitForResponse(response =>
            response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/urls'
        );

        await page.getByRole('button', { name: 'Shorten it!' }).click();

        const created = await createdResponse;
        expect(created.status()).toBe(201);

        code = (await created.json()).short_code;
        expect(code).toBe(customCode);
        const shortUrl = `${api}/${code}`;

        await expect(page.getByLabel('Paste your URL'))
            .toHaveValue(shortUrl);

        const redirect = await request.get(shortUrl, {
            maxRedirects: 0,
        });

        expect(redirect.status()).toBe(302);
        expect(redirect.headers().location)
            .toBe('https://example.com/e2e');

        const deleted = await request.delete(`${api}/api/urls/${code}`);
        expect(deleted.status()).toBe(204);

        const missing = await request.get(shortUrl, {
            maxRedirects: 0,
        });
        expect(missing.status()).toBe(404);
    } finally {
        if (code) {
            await request.delete(`${api}/api/urls/${code}`);
        }
    }
});
