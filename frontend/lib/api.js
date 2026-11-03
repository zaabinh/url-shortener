// Empty in production builds: the API is served on the same origin through Nginx.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const USE_MOCK_API = process.env.NODE_ENV !== 'production'
    && process.env.NEXT_PUBLIC_USE_MOCK_API === 'true';
const MOCK_STORAGE_KEY = 'url-shortener-demo-urls';
const REQUEST_TIMEOUT_MS = 15_000;

export const isMockApiEnabled = USE_MOCK_API;


// test UI
function readMockUrls() {
    if (typeof window === 'undefined') {
        throw new TypeError('Demo URL storage is only available in the browser.');
    }

    const stored = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (stored === null) return [];

    const urls = JSON.parse(stored);
    if (!Array.isArray(urls) || !urls.every((url) => (
        url
        && typeof url.short_code === 'string'
        && typeof url.short_url === 'string'
        && typeof url.original_url === 'string'
        && typeof url.click_count === 'number'
        && (url.expired_at === undefined
            || (typeof url.expired_at === 'string' && !Number.isNaN(Date.parse(url.expired_at))))
    ))) {
        throw new TypeError('Stored demo URL data is invalid. Clear the demo URLs and try again.');
    }
    return urls;
}

function writeMockUrls(urls) {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(urls));
}

function normalizeExpiration(expiredAt) {
    if (typeof expiredAt !== 'string' || expiredAt.trim() === '') {
        throw new Error('Choose an expiration time.');
    }

    const expiration = new Date(expiredAt);
    if (Number.isNaN(expiration.getTime()) || expiration.getTime() <= Date.now()) {
        throw new Error('Expiration time must be in the future.');
    }
    return expiration.toISOString();
}

function getShortenErrorMessage(status) {
    if (status === 400 || status === 422) {
        return 'Please check the URL and expiration time, then try again.';
    }
    if (status === 409) {
        return 'A conflict prevented this short URL from being created. Please try again.';
    }
    if (status === 429) {
        return 'Too many requests. Please wait a moment and try again.';
    }
    if (status >= 500) {
        return 'The shortening service encountered a problem. Please try again later.';
    }
    return `Could not shorten this URL (HTTP ${status}).`;
}

function getShortenRequestError(error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return new Error('The request timed out. Please try again.');
    }
    return new Error('Could not reach the shortening service. Check your connection and try again.');
}

function getRequestError(action, error) {
    const subject = action === 'load' ? 'load URLs' : 'delete this URL';
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return new Error(`The request to ${subject} timed out. Please try again.`);
    }
    return new Error(`Could not ${subject} because the service could not be reached. Check your connection and try again.`);
}

function shortenUrlWithMock(originalUrl, expiredAt) {
    const urls = readMockUrls();
    let shortCode;
    do {
        shortCode = Math.random().toString(36).slice(2, 9);
    } while (urls.some((url) => url.short_code === shortCode));

    const shortUrl = `https://short.example/${shortCode}`;
    urls.unshift({
        short_code: shortCode,
        short_url: shortUrl,
        original_url: originalUrl,
        click_count: 0,
        expired_at: expiredAt,
    });
    writeMockUrls(urls);
    return shortUrl;
}
//

// The backend accepts { original_url, expired_at } and returns { short_url }.
export async function shortenUrl(originalUrl, expirationValue) {
    const expiredAt = normalizeExpiration(expirationValue);
    if (USE_MOCK_API) return shortenUrlWithMock(originalUrl, expiredAt);

    let response;
    try {
        response = await fetch(`${API_BASE_URL}/api/urls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ original_url: originalUrl, expired_at: expiredAt }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw getShortenRequestError(error);
    }

    if (!response.ok) {
        throw new Error(getShortenErrorMessage(response.status));
    }

    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error('The service returned an invalid response.');
    }
    if (typeof data?.short_url !== 'string') {
        throw new TypeError('The service returned an invalid URL.');
    }

    let shortUrl;
    try {
        shortUrl = new URL(data.short_url);
    } catch {
        throw new Error('The service returned an invalid URL.');
    }
    if (!['http:', 'https:'].includes(shortUrl.protocol)) {
        throw new Error('The service returned an invalid URL.');
    }
    return shortUrl.href;
}

export async function listUrls() {
    if (USE_MOCK_API) return readMockUrls();

    let response;
    try {
        response = await fetch(`${API_BASE_URL}/api/urls`, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw getRequestError('load', error);
    }
    if (!response.ok) {
        throw new Error(`Could not load URLs (HTTP ${response.status}).`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
        throw new TypeError('The URL list response must be a JSON array.');
    }
    return data;
}

export async function deleteUrl(shortCode) {
    if (USE_MOCK_API) {
        const urls = readMockUrls();
        writeMockUrls(urls.filter((url) => url.short_code !== shortCode));
        return;
    }

    let response;
    try {
        response = await fetch(`${API_BASE_URL}/api/urls/${encodeURIComponent(shortCode)}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw getRequestError('delete', error);
    }
    if (!response.ok) {
        throw new Error(`Could not delete URL (HTTP ${response.status}).`);
    }
}
