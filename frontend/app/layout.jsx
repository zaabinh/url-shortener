import '../css/style.css';

export const metadata = {
    title: 'URL Shortener',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
