import '../css/style.css';

export const metadata = {
    title: 'URL Shortener',
    icons: {
        icon: [
            { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
            { url: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
        ],
        apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    },
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
