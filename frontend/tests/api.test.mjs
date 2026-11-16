import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('create and list use the API redirect path and backend expiration field', async () => {
    const previousBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    const originalFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://short.example';
    try {
        const source = await readFile(new URL('../lib/api.js', import.meta.url), 'utf8');
        const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
        const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
        globalThis.fetch = async (url, options) => {
            assert.equal(url, 'https://short.example/api/urls');
            assert.equal(options.method, 'POST');
            assert.deepEqual(JSON.parse(options.body), {
                original_url: 'https://example.com', expires_at: expiresAt,
            });
            return new Response(JSON.stringify({ short_code: 'abc123' }), { status: 201 });
        };
        assert.equal(await api.shortenUrl('https://example.com', expiresAt), 'https://short.example/abc123');
        globalThis.fetch = async (url, options) => {
            assert.equal(url, 'https://short.example/api/urls?limit=32&offset=0');
            return new Response(JSON.stringify([{ short_code: 'abc123', expires_at: expiresAt }]));
        };
        const [url] = await api.listUrls();
        assert.equal(url.short_url, 'https://short.example/abc123');
        assert.equal(url.expires_at, expiresAt);
        assert.throws(() => api.getShortUrl(undefined), /invalid short code/);
        assert.equal(api.getShortUrl('a/b'), 'https://short.example/a%2Fb');
    } finally {
        globalThis.fetch = originalFetch;
        if (previousBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
        else process.env.NEXT_PUBLIC_API_BASE_URL = previousBase;
    }
});
