'use client';

import { useState } from 'react';
import UrlForm from '../components/UrlForm';
import RecentUrls from '../components/RecentUrls';

export default function Home() {
    const [refreshKey, setRefreshKey] = useState(0);

    return (
        <>
            <h1>Make your <span className="headline-url">URL</span> <span className="headline-shorter">shorter</span> <span className="headline-here">here<span className="headline-arrow" aria-hidden="true">↘</span></span></h1>
            <main>
                <UrlForm onCreated={() => setRefreshKey((key) => key + 1)} />
                <RecentUrls refreshKey={refreshKey} />
            </main>
        </>
    );
}
