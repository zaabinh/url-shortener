'use client';

import { useRef, useState } from 'react';
import { shortenUrl } from '../lib/api';

export default function UrlForm({ onCreated }) {
    const [value, setValue] = useState('');
    const [mode, setMode] = useState('long');
    const [busy, setBusy] = useState(false);
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
            announce('Short URL copied to clipboard.');
        } catch {
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
        setBusy(true);
        setMode('short');
        announce('Shortening your URL…');
        try {
            const short = pair.current?.original === original ? pair.current.short : await shortenUrl(original);
            pair.current = { original, short };
            setValue(short);
            onCreated?.();
            announce('Short URL ready in the field. Click or stretch the button right to restore the original.');
        } catch {
            setMode('long');
            announce('Could not shorten this URL. Check that the shortening service is running and try again.', true);
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
                        <span className="toggle-grip" aria-hidden="true">&#8942;</span>
                        <span className="toggle-label">{label}</span>
                    </button>
                </div>
            </div>
            <p id="url-hint" className="url-hint">Pull the button left to shorten. Stretch it right to expand. Or click to switch.</p>
            {mode === 'short' && pair.current?.short === value && (
                <button className="copy-button" type="button" onClick={copyShortUrl}>
                    Copy short URL
                </button>
            )}
            <p id="url-status" className="url-status" role="status" aria-live="polite" data-error={String(status.error)}>{status.message}</p>
        </form>
    );
}
