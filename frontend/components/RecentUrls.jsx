'use client';

import { useEffect, useState } from 'react';
import { deleteUrl, listUrls } from '../lib/api';

export default function RecentUrls({ refreshKey }) {
    const [urls, setUrls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [deletingCode, setDeletingCode] = useState('');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');

        listUrls()
            .then((items) => {
                if (active) setUrls(items);
            })
            .catch((requestError) => {
                if (active) setError(requestError.message);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [refreshKey]);

    async function handleDelete(shortCode) {
        setDeletingCode(shortCode);
        setError('');

        try {
            await deleteUrl(shortCode);
            setUrls((current) => current.filter((url) => url.short_code !== shortCode));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setDeletingCode('');
        }
    }

    return (
        <section className="url-list" aria-labelledby="recent-urls-heading">
            <h2 id="recent-urls-heading">Recent URLs</h2>
            {loading && <p className="url-list-message">Loading URLs…</p>}
            {error && <p className="url-list-message" role="alert">{error}</p>}
            {!loading && !error && urls.length === 0 && (
                <p className="url-list-message">No shortened URLs yet.</p>
            )}
            {urls.length > 0 && (
                <ul className="recent-url-items">
                    {urls.map((url) => (
                        <li className="recent-url-item" key={url.short_code}>
                            <div className="recent-url-details">
                                <a className="recent-short-url" href={url.short_url}>
                                    {url.short_url}
                                </a>
                                <span className="recent-original-url">{url.original_url}</span>
                                <span className="recent-click-count">
                                    Clicks: {url.click_count}
                                </span>
                            </div>
                            <button
                                className="delete-url-button"
                                type="button"
                                disabled={deletingCode === url.short_code}
                                onClick={() => handleDelete(url.short_code)}
                            >
                                {deletingCode === url.short_code ? 'Deleting…' : 'Delete'}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
