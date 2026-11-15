'use client';

import { useEffect, useRef, useState } from 'react';
import { deleteUrl, listUrls } from '../lib/api';

const PAGE_SIZE = 20;

function formatExpiration(expiredAt) {
    const expiration = new Date(expiredAt);
    if (Number.isNaN(expiration.getTime())) return 'an unknown time';
    return expiration.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

export default function RecentUrls({ refreshKey }) {
    const [urls, setUrls] = useState([]);
    const [offset, setOffset] = useState(0);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const [retryKey, setRetryKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState('');
    const [deleteError, setDeleteError] = useState('');
    const [failedDeleteCode, setFailedDeleteCode] = useState('');
    const [expiredNotice, setExpiredNotice] = useState('');
    const [deletingCode, setDeletingCode] = useState('');
    const [confirmingCode, setConfirmingCode] = useState('');
    const deleteInProgress = useRef(false);

    useEffect(() => setOffset(0), [refreshKey]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setListError('');
        setExpiredNotice('');

        listUrls({ limit: PAGE_SIZE + 1, offset })
            .then((items) => {
                if (!active) return;
                if (items.length === 0 && offset > 0) {
                    setOffset((current) => Math.max(0, current - PAGE_SIZE));
                    return;
                }
                setUrls(items.slice(0, PAGE_SIZE));
                setHasNextPage(items.length > PAGE_SIZE);
            })
            .catch((requestError) => {
                if (active) setListError(requestError.message);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [refreshKey, retryKey, offset]);

    async function confirmDelete(shortCode) {
        if (deleteInProgress.current) return;
        deleteInProgress.current = true;
        setDeletingCode(shortCode);
        setDeleteError('');
        setFailedDeleteCode('');

        try {
            await deleteUrl(shortCode);
            setUrls((current) => current.filter((url) => url.short_code !== shortCode));
            setConfirmingCode('');
            setRetryKey((current) => current + 1);
        } catch (requestError) {
            setDeleteError(requestError.message);
            setFailedDeleteCode(shortCode);
        } finally {
            deleteInProgress.current = false;
            setDeletingCode('');
        }
    }

    function handleShortUrlClick(event, url) {
        const expiration = Date.parse(url.expires_at);
        if (Number.isNaN(expiration) || expiration > Date.now()) return;

        event.preventDefault();
        setNow(Date.now());
        setExpiredNotice(`This short link has expired (HTTP 410 Gone). It expired ${formatExpiration(url.expires_at)}.`);
    }

    return (
        <section className="url-list" aria-labelledby="recent-urls-heading" id='recent-urls'>
            <div className="url-list-header">
                <h2 id="recent-urls-heading">Recent URLs</h2>
                <button
                    type='button'
                    className='refresh-button'
                    disabled={loading||Boolean(deletingCode)}
                    onClick={() => setRetryKey((key) => key + 1)}
                >
                    {loading ? 'Refreshing...' : "Refresh"}
                </button>
            </div>
            {loading && <p className="url-list-message">Loading URLs…</p>}
            {!loading && listError && (
                <div className="url-list-error" role="alert">
                    <p className="url-list-message">Could not load URLs: {listError}</p>
                    <button
                        className="delete-url-button retry-button"
                        type="button"
                        onClick={() => setRetryKey((current) => current + 1)}
                    >
                        Retry
                    </button>
                </div>
            )}
            {deleteError && (
                <div className="url-list-error" role="alert">
                    <p className="url-list-message">{deleteError}</p>
                    <button
                        className="delete-url-button retry-button"
                        type="button"
                        onClick={() => confirmDelete(failedDeleteCode)}
                    >
                        Retry delete
                    </button>
                </div>
            )}
            {expiredNotice && <output className="url-list-message">{expiredNotice}</output>}
            {!loading && !listError && urls.length === 0 && (
                <p className="url-list-message">No shortened URLs yet.</p>
            )}
            {!loading && !listError && urls.length > 0 && (
                <ul className="recent-url-items">
                    {urls.map((url) => {
                        const expiration = Date.parse(url.expires_at);
                        const hasExpiration = !Number.isNaN(expiration);
                        const isExpired = hasExpiration && expiration <= now;

                        return (
                            <li
                                className={isExpired ? 'recent-url-item is-expired' : 'recent-url-item'}
                                key={url.short_code}
                            >
                                <div className="recent-url-details">
                                    {isExpired ? (
                                        <span
                                            className={isExpired ? 'recent-short-url is-expired-link' : 'recent-short-url'}
                                            aria-disabled="true"
                                        >
                                            {url.short_url}
                                        </span>
                                    ) : (
                                        <a
                                            className="recent-short-url"
                                            href={url.short_url}
                                            onClick={(event) => handleShortUrlClick(event, url)}
                                        >
                                            {url.short_url}
                                        </a>
                                    )}
                                    <span className="recent-original-url">{url.original_url}</span>
                                    <span className="recent-click-count">
                                        Clicks: {url.click_count}
                                    </span>
                                    {hasExpiration ? (
                                        <span className={isExpired ? 'recent-expiration is-expired' : 'recent-expiration'}>
                                            {isExpired ? 'Expired (HTTP 410 Gone)' : 'Expires'}: {formatExpiration(url.expires_at)}
                                        </span>
                                    ) : (
                                        <span className="recent-expiration">Expiration unavailable</span>
                                    )}
                                </div>
                                <div className="recent-url-actions">
                                    {isExpired ? (
                                        <button className="go-button" type="button" disabled>Go</button>
                                    ) : (
                                        <a className="go-button" href={url.short_url} target="_blank" rel="noopener noreferrer" onClick={(event) => handleShortUrlClick(event, url)} aria-label={`Go to ${url.original_url}`}>
                                            Go <span aria-hidden="true">↗</span>
                                        </a>
                                    )}
                                {confirmingCode === url.short_code ? (
                                    <fieldset className="delete-confirmation">
                                        <legend>Are you sure?</legend>
                                        <div className="delete-confirmation-actions">
                                            <button
                                                className="delete-url-button confirm-yes"
                                                type="button"
                                                disabled={Boolean(deletingCode)}
                                                onClick={() => confirmDelete(url.short_code)}
                                            >
                                                {deletingCode === url.short_code ? 'Deleting…' : 'Yes'}
                                            </button>
                                            <button
                                                className="delete-url-button confirm-no"
                                                type="button"
                                                disabled={Boolean(deletingCode)}
                                                onClick={() => setConfirmingCode('')}
                                            >
                                                No
                                            </button>
                                        </div>
                                    </fieldset>
                                ) : (
                                    <button
                                        className="delete-url-button"
                                        type="button"
                                        disabled={Boolean(deletingCode)}
                                        onClick={() => setConfirmingCode(url.short_code)}
                                    >
                                        Delete
                                    </button>
                                )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
            {!loading && !listError && (offset > 0 || hasNextPage) && (
                <nav className="url-pagination" aria-label="Recent URL pages">
                    <button className="refresh-button" type="button" disabled={offset === 0 || Boolean(deletingCode)} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>
                        Previous
                    </button>
                    <span>Page {offset / PAGE_SIZE + 1}</span>
                    <button className="refresh-button" type="button" disabled={!hasNextPage || Boolean(deletingCode)} onClick={() => setOffset((current) => current + PAGE_SIZE)}>
                        Next
                    </button>
                </nav>
            )}
        </section>
    );
}
