'use client';

import { useEffect, useState } from 'react';
import UrlForm from '../components/UrlForm';
import RecentUrls from '../components/RecentUrls';

export default function Home() {
    const [refreshKey, setRefreshKey] = useState(0);
    const [showBackToTop, setShowBackToTop] = useState(false);

    useEffect(() => {
        function updateBackToTop() {
            const recent = document.getElementById('recent-urls');
            setShowBackToTop(window.scrollY > 0 && recent.getBoundingClientRect().top < window.innerHeight);
        }
        updateBackToTop();
        window.addEventListener('scroll', updateBackToTop, { passive: true });
        window.addEventListener('resize', updateBackToTop);
        return () => {
            window.removeEventListener('scroll', updateBackToTop);
            window.removeEventListener('resize', updateBackToTop);
        };
    }, []);

    return (
        <main className="site-main" id="top">
            <section className="hero" aria-labelledby="hero-heading">
                <div className="brand-mark">
                    <img
                        src="/favicon.svg"
                        alt=""
                        width={32}
                        height={32}
                    />
                    <span>URL Shortener</span>
                </div>

                <div className="hero-content">
                    <h1 id="hero-heading" className="hero-title">
                        Make your{' '}
                        <span className="headline-url">URL</span>{' '}
                        <span className="headline-shorter">shorter</span>{' '}
                        <span className="headline-here">
                            here <span className="headline-arrow" aria-hidden="true">
                                ↘
                            </span>
                        </span>
                    </h1>

                    <div className="form-panel">
                        <UrlForm
                            onCreated={() => setRefreshKey((key) => key + 1)}
                        />
                    </div>
                </div>

                <a className="recent-jump" href="#recent-urls">
                    Recent URLs <span aria-hidden="true">↓</span>
                </a>
            </section>

            <RecentUrls refreshKey={refreshKey} />
            {showBackToTop && (
                <a className="back-to-top" href="#top">
                    <span aria-hidden="true">↑</span> Back to top
                </a>
            )}
        </main>
    );
}
