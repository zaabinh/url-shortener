// Empty in production builds: the API is served on the same origin through Nginx.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

// The backend should accept { original_url } and return { short_url }.
export async function shortenUrl(originalUrl) {
    const response = await fetch(`${API_BASE_URL}/api/urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_url: originalUrl }),
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        throw new Error('Shortening is unavailable. Please try again later.');
    }

    const data = await response.json();
    const shortUrl = new URL(data.short_url);
    if (!['http:', 'https:'].includes(shortUrl.protocol)) {
        throw new Error('The service returned an invalid URL.');
    }
    return shortUrl.href;
}

export async function listUrls() {
    const response = await fetch(`${API_BASE_URL}/api/urls`);
    if (!response.ok) {
        throw new Error(`Could not load URLs (HTTP ${response.status}).`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
        throw new Error('The URL list response must be a JSON array.');
    }
    return data;
}

export async function deleteUrl(shortCode) {
    const response = await fetch(`${API_BASE_URL}/api/urls/${encodeURIComponent(shortCode)}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error(`Could not delete URL (HTTP ${response.status}).`);
    }
}
