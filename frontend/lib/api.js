// An empty base URL sends API requests to the page's origin.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const REQUEST_TIMEOUT_MS = 15_000;
export function getShortUrl(shortCode) {
    if (typeof shortCode !== 'string' || !shortCode.trim()) {
        throw new TypeError('The service returned an invalid short code.');
    }
    const base = API_BASE_URL || window.location.origin;
    const url = new URL(`${base.replace(/\/$/, '')}/api/urls/${encodeURIComponent(shortCode)}`);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new TypeError('The service returned an invalid URL.');
    }
    return url.href;
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

// The backend returns the short code; redirect URLs use the same API origin.
export async function shortenUrl(originalUrl, expirationValue) {
    const expiredAt = normalizeExpiration(expirationValue);
    const headers = { 'Content-Type': 'application/json' };

    let response;
    try {
        response = await fetch(`${API_BASE_URL}/api/urls`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ original_url: originalUrl, expires_at: expiredAt }),
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

    return getShortUrl(data?.short_code);
}

export async function listUrls({ limit = 20, offset = 0 } = {}) {

    let response;
    try {
        response = await fetch(`${API_BASE_URL}/api/urls?limit=${limit}&offset=${offset}`, {
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
    return data.map((url) => ({ ...url, short_url: getShortUrl(url.short_code) }));
}

export async function deleteUrl(shortCode) {
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
