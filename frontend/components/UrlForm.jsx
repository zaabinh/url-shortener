'use client';

import { useRef, useState } from 'react';
import { shortenUrl } from '../lib/api';

function toLocalDateTimeInputValue(date) {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 16);
}

function formatExpiration(dateTimeValue) {
    const date = new Date(dateTimeValue);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

export default function UrlForm({ onCreated }) {
    const [value, setValue] = useState('');
    const [expiredAt, setExpiredAt] = useState('');
    const [mode, setMode] = useState('long');
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [status, setStatus] = useState({ message: '', error: false });
    const [dragWidth, setDragWidth] = useState(null);
    const formRef = useRef(null);
    const controlRef = useRef(null);
    const fieldSpaceRef = useRef(null);
    const pair = useRef(null);
    const drag = useRef(null);
    const suppressClick = useRef(false);

    function announce(message, error = false) {
        setStatus({ message, error });
    }

    async function copyShortUrl() {
        const shortUrl = pair.current?.short;
        if (!shortUrl || value !== shortUrl) return;

        try {
            await navigator.clipboard.writeText(shortUrl);
            setCopied(true);
            announce('Short URL copied to clipboard.');
        } catch {
            setCopied(false);
            announce('Could not access clipboard. Select and copy the short URL from the field.', true);
        }
    }

    async function switchUrl(requested) {
        if (busy) return;
        const target = requested ?? (mode === 'short' ? 'long' : 'short');
        if (target === 'long') {
            if (!pair.current || value !== pair.current.short) {
                announce('Shorten a URL here first to restore its original.', true);
                return;
            }
            setValue(pair.current.original);
            setMode('long');
            setCopied(false);
            announce('Original URL restored.');
            return;
        }
        if (mode === 'short') return;
        if (!formRef.current.reportValidity()) return;
        const original = value.trim();
        if (!['http:', 'https:'].includes(new URL(original).protocol)) {
            announce('Enter a URL starting with https:// or http://.', true);
            return;
        }
        const expirationDate = new Date(expiredAt);
        if (!expiredAt || Number.isNaN(expirationDate.getTime()) || expirationDate.getTime() <= Date.now()) {
            announce('Choose an expiration time in the future.', true);
            return;
        }
        const expirationUtc = expirationDate.toISOString();
        setBusy(true);
        setMode('short');
        announce('Shortening your URL…');
        try {
            const short = await shortenUrl(original, expiredAt);
            pair.current = { original, short, expiredAt: expirationUtc };
            setValue(short);
            setCopied(false);
            onCreated?.();
            announce(`Short URL ready. Expires ${formatExpiration(expirationDate)}. Click or stretch the button right to restore the original.`);
        } catch (error) {
            setMode('long');
            announce(error instanceof Error
                ? error.message
                : 'Could not shorten this URL. Check that the shortening service is running and try again.', true);
        } finally {
            setBusy(false);
        }
    }

    function handleSubmit(event) {
        event.preventDefault();
        switchUrl();
    }

    function handleInput(event) {
        const next = event.target.value;
        setValue(next);
        setMode(pair.current && next === pair.current.short ? 'short' : 'long');
        setCopied(false);
        announce('');
    }

    function handleKeyDown(event) {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        switchUrl(event.key === 'ArrowLeft' ? 'short' : 'long');
    }

    function handlePointerDown(event) {
        if (busy || !event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        const fieldSpace = fieldSpaceRef.current;
        const control = controlRef.current;
        const compactStyle = getComputedStyle(control).getPropertyValue('--compact-width');
        // Read the responsive compact target from CSS without changing the visible field.
        const compactProbe = document.createElement('div');
        compactProbe.style.cssText = `position:absolute;visibility:hidden;width:${compactStyle};height:0;pointer-events:none`;
        fieldSpace.append(compactProbe);
        const minWidth = compactProbe.getBoundingClientRect().width;
        compactProbe.remove();
        drag.current = {
            id: event.pointerId,
            start: event.clientX,
            origin: control.getBoundingClientRect().width,
            minWidth,
            maxWidth: fieldSpace.clientWidth,
            delta: 0,
            moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function handlePointerMove(event) {
        const current = drag.current;
        if (!current || event.pointerId !== current.id) return;
        current.delta = event.clientX - current.start;
        if (Math.abs(current.delta) > 6) current.moved = true;
        if (!current.moved) return;
        setDragWidth(Math.max(current.minWidth, Math.min(current.maxWidth, current.origin + current.delta)));
    }

    function endDrag(event) {
        const finished = drag.current;
        if (!finished || event.pointerId !== finished.id) return;
        drag.current = null;
        setDragWidth(null);
        const button = event.currentTarget;
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
        if (!finished.moved) return;
        suppressClick.current = true;
        if (event.type === 'pointerup' && Math.abs(finished.delta) >= 16) {
            switchUrl(finished.delta < 0 ? 'short' : 'long');
        }
    }

    function handleClick(event) {
        if (suppressClick.current && event.detail !== 0) {
            event.preventDefault();
            suppressClick.current = false;
        }
    }

    const dragging = dragWidth !== null;
    const label = busy ? 'Shortening…' : mode === 'short' ? 'Expand it!' : 'Shorten it!';
    const minimumExpiration = new Date();
    minimumExpiration.setSeconds(0, 0);
    minimumExpiration.setMinutes(minimumExpiration.getMinutes() + 1);

    return (
        <form ref={formRef} className="url-form" onSubmit={handleSubmit} aria-busy={busy || undefined}>
            <label htmlFor="url">Paste your URL</label>
            <div ref={fieldSpaceRef} className="url-field-space">
                <div
                    ref={controlRef}
                    className={dragging ? 'url-control is-dragging' : 'url-control'}
                    data-mode={mode}
                    style={dragging ? { '--drag-width': `${dragWidth}px` } : undefined}
                >
                    <input
                        type="url"
                        name="url"
                        id="url"
                        required
                        placeholder="https://example.com/your-long-link"
                        aria-describedby="url-hint url-status"
                        value={value}
                        onChange={handleInput}
                        readOnly={busy}
                    />
                    <button
                        className="url-toggle"
                        type="submit"
                        aria-describedby="url-hint"
                        disabled={busy}
                        onKeyDown={handleKeyDown}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onLostPointerCapture={endDrag}
                        onClick={handleClick}
                    >
                        <span className="toggle-label">{label}</span>
                    </button>
                </div>
            </div>
            <label htmlFor="expired-at">Expiration date and time</label>
            <input
                className="expiration-input"
                type="datetime-local"
                name="expired_at"
                id="expired-at"
                lang="en"
                required
                min={toLocalDateTimeInputValue(minimumExpiration)}
                aria-describedby="expiration-hint url-status"
                value={expiredAt}
                onChange={(event) => {
                    setExpiredAt(event.target.value);
                    announce('');
                }}
                disabled={busy}
            />
            <p id="expiration-hint" className="url-hint">Use your local time. The expiration is sent to the service in UTC.</p>
            <p id="url-hint" className="url-hint">Pull the button left to shorten. Stretch it right to expand. Or click to switch.</p>
            {mode === 'short' && pair.current?.short === value && (
                <button
                    className={copied ? 'copy-button is-copied' : 'copy-button'}
                    type="button"
                    onClick={copyShortUrl}
                >
                    {copied ? '✓ Copied!' : 'Copy short URL'}
                </button>
            )}
            <p id="url-status" className="url-status" role="status" aria-live="polite" data-error={String(status.error)}>{status.message}</p>
        </form>
    );
}
