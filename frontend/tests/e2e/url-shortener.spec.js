import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8080';

function makeUrl(shortCode, overrides = {}) {
    return {
        short_code: shortCode,
        short_url: `${BASE_URL}/${shortCode}`,
        original_url: 'https://example.com/long-link',
        click_count: 0,
        expired_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ...overrides,
    };
}

async function setFutureExpiration(page) {
    const value = await page.evaluate(() => {
        const date = new Date(Date.now() + 60 * 60 * 1000);
        const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
        return localDate.toISOString().slice(0, 16);
    });
    await page.locator('#expired-at').fill(value);
    return value;
}

async function mockApi(page, initialUrls = []) {
    const urls = [...initialUrls];
    const requests = { creates: [], lists: 0, deletes: [] };

    await page.route('**/api/urls**', async (route) => {
        const request = route.request();
        const method = request.method();
        const pathname = new URL(request.url()).pathname;

        if (method === 'GET' && pathname === '/api/urls') {
            requests.lists += 1;
            await route.fulfill({ json: urls });
            return;
        }

        if (method === 'POST' && pathname === '/api/urls') {
            const body = request.postDataJSON();
            requests.creates.push(body);
            const created = makeUrl(`code${requests.creates.length}`, {
                short_url: `${new URL(request.url()).origin}/code${requests.creates.length}`,
                original_url: body.original_url,
                expired_at: body.expired_at,
            });
            urls.unshift(created);
            await route.fulfill({ status: 201, json: { short_url: created.short_url } });
            return;
        }

        if (method === 'DELETE') {
            const shortCode = pathname.split('/').at(-1);
            requests.deletes.push(shortCode);
            const index = urls.findIndex((url) => url.short_code === shortCode);
            if (index !== -1) urls.splice(index, 1);
            await route.fulfill({ status: 204 });
            return;
        }

        await route.fulfill({ status: 404, json: { detail: 'Not found' } });
    });

    return { urls, requests };
}

async function openForm(page, originalUrl = 'https://example.com/long-link') {
    await page.goto('/');
    await page.getByLabel('Paste your URL').fill(originalUrl);
    return setFutureExpiration(page);
}

test('creates a short URL and sends expiration in UTC', async ({ page }) => {
    const { requests } = await mockApi(page);
    const expirationValue = await openForm(page);

    await page.getByRole('button', { name: 'Shorten it!' }).click();

    await expect(page.getByText(`${BASE_URL}/code1`)).toBeVisible();
    const expectedExpiration = await page.evaluate((value) => new Date(value).toISOString(), expirationValue);
    expect(requests.creates).toHaveLength(1);
    expect(requests.creates[0]).toEqual({
        original_url: 'https://example.com/long-link',
        expired_at: expectedExpiration,
    });
    expect(requests.creates[0].expired_at).toMatch(/Z$/);
});

test('does not send an invalid URL', async ({ page }) => {
    const { requests } = await mockApi(page);
    await page.goto('/');
    await page.getByLabel('Paste your URL').fill('not a valid URL');
    await setFutureExpiration(page);
    await page.getByRole('button', { name: 'Shorten it!' }).click();

    expect(await page.locator('#url').evaluate((input) => input.validity.typeMismatch)).toBe(true);
    expect(requests.creates).toHaveLength(0);
});

test('shows a safe validation error when creation fails', async ({ page }) => {
    const requests = [];
    await page.route('**/api/urls', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ json: [] });
            return;
        }
        requests.push(route.request().postDataJSON());
        await route.fulfill({
            status: 422,
            json: { detail: 'SECRET server traceback and database details' },
        });
    });
    await openForm(page);
    await page.getByRole('button', { name: 'Shorten it!' }).click();

    await expect(page.locator('#url-status')).toContainText('Please check the URL and expiration time');
    await expect(page.locator('#url-status')).not.toContainText('SECRET');
    await expect(page.getByText('No shortened URLs yet.')).toBeVisible();
    expect(requests).toHaveLength(1);
});

test('refreshes the recent URL list after a successful create', async ({ page }) => {
    const { requests } = await mockApi(page);
    await openForm(page);

    await page.getByRole('button', { name: 'Shorten it!' }).click();

    await expect.poll(() => requests.lists).toBe(2);
    await expect(page.getByText(`${BASE_URL}/code1`)).toBeVisible();
});

test('deletes a recent short URL', async ({ page }) => {
    const { requests } = await mockApi(page, [makeUrl('delete-me')]);
    await page.goto('/');
    await expect(page.getByText(`${BASE_URL}/delete-me`)).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(page.getByText(`${BASE_URL}/delete-me`)).toHaveCount(0);
    expect(requests.deletes).toEqual(['delete-me']);
});

test('creates a new mapping after its previous mapping was deleted', async ({ page }) => {
    const { requests } = await mockApi(page);
    await openForm(page);
    await page.getByRole('button', { name: 'Shorten it!' }).click();
    await expect(page.getByText(`${BASE_URL}/code1`)).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(page.getByText(`${BASE_URL}/code1`)).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand it!' }).click();
    await page.getByRole('button', { name: 'Shorten it!' }).click();
    await expect(page.getByText(`${BASE_URL}/code2`)).toBeVisible();

    expect(requests.creates).toHaveLength(2);
    expect(requests.deletes).toEqual(['code1']);
});

test('marks expired links as HTTP 410 Gone and disables navigation', async ({ page }) => {
    const expiredUrl = makeUrl('expired', { expired_at: '2020-01-01T00:00:00.000Z' });
    await mockApi(page, [expiredUrl]);
    await page.goto('/');

    await expect(page.getByText('Expired (HTTP 410 Gone)')).toBeVisible();
    await expect(page.getByText(expiredUrl.short_url, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: expiredUrl.short_url })).toHaveCount(0);
});

test('offers retry and hides old URL data when list loading fails', async ({ page }) => {
    let listRequests = 0;
    await page.route('**/api/urls', async (route) => {
        listRequests += 1;
        if (listRequests === 1) {
            await route.fulfill({ status: 503, json: { detail: 'backend internals' } });
            return;
        }
        await route.fulfill({ json: [] });
    });
    await page.goto('/');

    await expect(page.locator('.url-list-error')).toContainText('Could not load URLs');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('No shortened URLs yet.')).toBeVisible();
    expect(listRequests).toBe(2);
});

test('rejects a non-array list response with a TypeError', async () => {
    const previousMockSetting = process.env.NEXT_PUBLIC_USE_MOCK_API;
    const previousApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_USE_MOCK_API = 'false';
    process.env.NEXT_PUBLIC_API_BASE_URL = '';

    try {
        const source = await readFile(path.resolve(process.cwd(), 'lib/api.js'), 'utf8');
        const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
        globalThis.fetch = async () => new Response(JSON.stringify({ urls: [] }), {
            headers: { 'Content-Type': 'application/json' },
        });

        await assert.rejects(api.listUrls(), {
            name: 'TypeError',
            message: 'The URL list response must be a JSON array.',
        });
    } finally {
        globalThis.fetch = originalFetch;
        if (previousMockSetting === undefined) {
            delete process.env.NEXT_PUBLIC_USE_MOCK_API;
        } else {
            process.env.NEXT_PUBLIC_USE_MOCK_API = previousMockSetting;
        }
        if (previousApiBaseUrl === undefined) {
            delete process.env.NEXT_PUBLIC_API_BASE_URL;
        } else {
            process.env.NEXT_PUBLIC_API_BASE_URL = previousApiBaseUrl;
        }
    }
});
