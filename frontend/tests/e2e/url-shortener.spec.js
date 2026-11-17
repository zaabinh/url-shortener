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
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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
            const query = new URL(request.url()).searchParams;
            const offset = Number(query.get('offset') ?? 0);
            const limit = Number(query.get('limit') ?? 20);
            await route.fulfill({ json: urls.slice(offset, offset + limit) });
            return;
        }

        if (method === 'POST' && pathname === '/api/urls') {
            const body = request.postDataJSON();
            requests.creates.push(body);
            const code = body.short_code || `code${requests.creates.length}`;
            if (urls.some((item) => item.short_code === code)) {
                await route.fulfill({ status: 409, json: { detail: 'Short code already exists' } });
                return;
            }
            const created = makeUrl(code, {
                short_url: `${new URL(request.url()).origin}/${code}`,
                original_url: body.original_url,
                expires_at: body.expires_at,
            });
            urls.unshift(created);
            await route.fulfill({ status: 201, json: created });
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

    await expect(page.getByRole('link', { name: `${BASE_URL}/code1`, exact: true })).toBeVisible();
    const expectedExpiration = await page.evaluate((value) => new Date(value).toISOString(), expirationValue);
    expect(requests.creates).toHaveLength(1);
    expect(requests.creates[0]).toEqual({
        original_url: 'https://example.com/long-link',
        expires_at: expectedExpiration,
    });
    expect(requests.creates[0].expires_at).toMatch(/Z$/);
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

test('creates a custom code and resets it', async ({ page }) => {
    const { requests } = await mockApi(page);
    await openForm(page);
    const custom = page.getByLabel('Custom short code (optional)');
    await custom.fill('myCode');
    await page.getByRole('button', { name: 'Shorten it!' }).click();

    await expect(page.getByLabel('Paste your URL')).toHaveValue(`${BASE_URL}/myCode`);
    expect(requests.creates[0].short_code).toBe('myCode');
    await expect(custom).toBeDisabled();
    await page.getByRole('button', { name: 'Expand it!' }).click();
    await page.getByRole('button', { name: 'Shorten it!' }).click();
    expect(requests.creates).toHaveLength(1);

    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(custom).toHaveValue('');
    await expect(custom).toBeEnabled();
});

test('rejects an invalid custom code without posting', async ({ page }) => {
    const { requests } = await mockApi(page);
    await openForm(page);
    const custom = page.getByLabel('Custom short code (optional)');
    await custom.fill('invalid-code');
    await page.getByRole('button', { name: 'Shorten it!' }).click();

    expect(await custom.evaluate((input) => input.validity.patternMismatch)).toBe(true);
    expect(requests.creates).toHaveLength(0);
});

test('keeps form values after a custom-code conflict and allows retry', async ({ page }) => {
    const existing = makeUrl('taken');
    const { requests } = await mockApi(page, [existing]);
    const expiration = await openForm(page);
    const custom = page.getByLabel('Custom short code (optional)');
    await custom.fill('taken');
    await page.getByRole('button', { name: 'Shorten it!' }).click();

    await expect(page.locator('#url-status')).toContainText('conflict prevented');
    await expect(page.getByLabel('Paste your URL')).toHaveValue('https://example.com/long-link');
    await expect(page.locator('#expired-at')).toHaveValue(expiration);
    await expect(custom).toHaveValue('taken');
    await expect(custom).toBeEnabled();

    await custom.fill('available');
    await page.getByRole('button', { name: 'Shorten it!' }).click();
    await expect(page.getByLabel('Paste your URL')).toHaveValue(`${BASE_URL}/available`);
    expect(requests.creates.map((body) => body.short_code)).toEqual(['taken', 'available']);
});

test('fits the shortened URL control to text plus chrome', async ({ page }) => {
    await mockApi(page);
    await openForm(page);
    await page.getByRole('button', { name: 'Shorten it!' }).click();

    await expect.poll(() => page.locator('.url-control').evaluate((control) => {
        const space = control.parentElement;
        const input = control.querySelector('#url');
        const button = control.querySelector('.url-toggle');
        const measure = space.querySelector('.url-measure');
        const inputStyle = getComputedStyle(input);
        const controlStyle = getComputedStyle(control);
        const px = (style, key) => Number.parseFloat(style[key]) || 0;
        const expected = Math.min(space.clientWidth, Math.ceil(
            measure.getBoundingClientRect().width
            + px(inputStyle, 'paddingLeft') + px(inputStyle, 'paddingRight')
            + px(inputStyle, 'borderLeftWidth') + px(inputStyle, 'borderRightWidth')
            + button.getBoundingClientRect().width
            + px(controlStyle, 'paddingLeft') + px(controlStyle, 'paddingRight')
            + px(controlStyle, 'borderLeftWidth') + px(controlStyle, 'borderRightWidth')
            + px(controlStyle, 'columnGap') + 2,
        ));
        return Math.abs(control.getBoundingClientRect().width - expected);
    })).toBeLessThanOrEqual(3);
});

test('clamps the shortened URL control on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await openForm(page);
    await page.getByLabel('Custom short code (optional)').fill('a'.repeat(32));
    await page.getByRole('button', { name: 'Shorten it!' }).click();

    const sizes = await page.locator('.url-control').evaluate((control) => ({
        control: control.getBoundingClientRect().width,
        space: control.parentElement.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(sizes.control).toBeLessThanOrEqual(sizes.space + 1);
    expect(sizes.overflow).toBeLessThanOrEqual(1);
});

test('shows a safe validation error when creation fails', async ({ page }) => {
    const requests = [];
    await page.route('**/api/urls**', async (route) => {
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
    await expect(page.getByRole('link', { name: `${BASE_URL}/code1`, exact: true })).toBeVisible();
});

test('deletes a recent short URL', async ({ page }) => {
    const { requests } = await mockApi(page, [makeUrl('delete-me')]);
    await page.goto('/');
    await expect(page.getByRole('link', { name: `${BASE_URL}/delete-me`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(page.getByRole('link', { name: `${BASE_URL}/delete-me`, exact: true })).toHaveCount(0);
    expect(requests.deletes).toEqual(['delete-me']);
});

test('keeps a URL after delete fails and allows retry', async ({ page }) => {
    const url = makeUrl('delete-retry');
    let deleteRequests = 0;
    await page.route('**/api/urls**', async (route) => {
        const request = route.request();
        if (request.method() === 'GET') {
            await route.fulfill({ json: deleteRequests >= 2 ? [] : [url] });
            return;
        }
        deleteRequests += 1;
        if (deleteRequests === 1) {
            await route.fulfill({ status: 503, json: { detail: 'backend internals' } });
            return;
        }
        await route.fulfill({ status: 204 });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(page.getByText(url.short_url, { exact: true })).toBeVisible();
    await expect(page.locator('.url-list-error[role="alert"]')).toContainText('Could not delete URL (HTTP 503)');
    await page.getByRole('button', { name: 'Retry delete' }).click();
    await expect(page.getByText(url.short_url, { exact: true })).toHaveCount(0);
    expect(deleteRequests).toBe(2);
});

test('requires reset before creating another mapping', async ({ page }) => {
    const { requests } = await mockApi(page);
    await openForm(page);
    await page.getByRole('button', { name: 'Shorten it!' }).click();
    await expect(page.getByRole('link', { name: `${BASE_URL}/code1`, exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(page.getByRole('link', { name: `${BASE_URL}/code1`, exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand it!' }).click();
    await page.getByRole('button', { name: 'Shorten it!' }).click();
    await expect(page.getByLabel('Paste your URL')).toHaveValue(`${BASE_URL}/code1`);
    expect(requests.creates).toHaveLength(1);

    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByLabel('Paste your URL')).toHaveValue('');
    await expect(page.locator('#expired-at')).toHaveValue('');
    await page.getByLabel('Paste your URL').fill('https://example.com/another');
    await setFutureExpiration(page);
    await page.getByRole('button', { name: 'Shorten it!' }).click();
    await expect(page.getByRole('link', { name: `${BASE_URL}/code2`, exact: true })).toBeVisible();

    expect(requests.creates).toHaveLength(2);
    expect(requests.deletes).toEqual(['code1']);
});

test('marks expired links as HTTP 410 Gone and disables navigation', async ({ page }) => {
    const expiredUrl = makeUrl('expired', { expires_at: '2020-01-01T00:00:00.000Z' });
    await mockApi(page, [expiredUrl]);
    await page.goto('/');

    await expect(page.getByText('Expired (HTTP 410 Gone)')).toBeVisible();
    await expect(page.getByText(expiredUrl.short_url, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: expiredUrl.short_url })).toHaveCount(0);
});

test('offers retry after a list timeout and displays the refreshed data', async ({ page }) => {
    let listRequests = 0;
    const recoveredUrl = makeUrl('recovered');
    await page.route('**/api/urls**', async (route) => {
        listRequests += 1;
        if (listRequests === 1) {
            await route.abort('timedout');
            return;
        }
        await route.fulfill({ json: [recoveredUrl] });
    });
    await page.goto('/');

    await expect(page.locator('.url-list-error')).toContainText('Could not load URLs');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(recoveredUrl.short_url, { exact: true })).toBeVisible();
    await expect(page.getByText(recoveredUrl.original_url, { exact: true })).toBeVisible();
    expect(listRequests).toBe(2);
});

test('rejects a non-array list response with a TypeError', async () => {
    const previousApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const originalFetch = globalThis.fetch;
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
        if (previousApiBaseUrl === undefined) {
            delete process.env.NEXT_PUBLIC_API_BASE_URL;
        } else {
            process.env.NEXT_PUBLIC_API_BASE_URL = previousApiBaseUrl;
        }
    }
});

test('maps list and delete timeout errors to retryable messages', async () => {
    const previousApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_API_BASE_URL = '';

    try {
        const source = await readFile(path.resolve(process.cwd(), 'lib/api.js'), 'utf8');
        const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
        const timeout = new DOMException('Timed out', 'TimeoutError');
        globalThis.fetch = async () => {
            throw timeout;
        };

        await assert.rejects(api.listUrls(), {
            name: 'Error',
            message: 'The request to load URLs timed out. Please try again.',
        });
        await assert.rejects(api.deleteUrl('retry-me'), {
            name: 'Error',
            message: 'The request to delete this URL timed out. Please try again.',
        });
    } finally {
        globalThis.fetch = originalFetch;
        if (previousApiBaseUrl === undefined) {
            delete process.env.NEXT_PUBLIC_API_BASE_URL;
        } else {
            process.env.NEXT_PUBLIC_API_BASE_URL = previousApiBaseUrl;
        }
    }
});

test('refreshes cards and exposes Go and Back to top navigation', async ({ page }) => {
    const { requests, urls } = await mockApi(page, [makeUrl('visit')]);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Go to https://example.com/long-link' })).toHaveAttribute('href', `${BASE_URL}/visit`);
    await expect(page.getByRole('link', { name: 'Back to top' })).toHaveCount(0);
    urls.push(makeUrl('refreshed'));
    await page.locator('.refresh-button').click();
    await expect(page.getByRole('link', { name: `${BASE_URL}/refreshed`, exact: true })).toBeVisible();
    expect(requests.lists).toBeGreaterThanOrEqual(2);
    await page.getByRole('link', { name: 'Recent URLs', exact: true }).click();
    const back = page.getByRole('link', { name: 'Back to top' });
    await expect(back).toBeVisible();
    expect(await back.evaluate(el => getComputedStyle(el).position)).toBe('fixed');
    await back.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(back).toHaveCount(0);
});

test('paginates recent URLs without dropping older records', async ({ page }) => {
    await mockApi(page, Array.from({length:25}, (_,i) => makeUrl('page' + i)));
    await page.goto('/');
    await expect(page.locator('.recent-url-item')).toHaveCount(20);
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await expect(page.locator('.recent-url-item')).toHaveCount(5);
    await expect(page.getByText('Page 2', {exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Previous',exact:true}).click();
    await expect(page.locator('.recent-url-item')).toHaveCount(20);
});
