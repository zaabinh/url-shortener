import UrlForm from '../components/UrlForm';

export default function Home() {
    return (
        <>
            <h1>Make your <span className="headline-url">URL</span> <span className="headline-shorter">shorter</span> <span className="headline-here">here<span className="headline-arrow" aria-hidden="true">↘</span></span></h1>
            <main>
                <UrlForm />

                <div className="url-list">
                    <h2>Recent URLs</h2>
                </div>
            </main>
        </>
    );
}
