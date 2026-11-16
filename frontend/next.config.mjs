/** @type {import('next').NextConfig} */
const nextConfig = {
    // `next build` writes plain HTML/CSS/JS to out/, for static hosting.
    output: 'export',
    // Stop `next dev` from generating an AGENTS.md file in the repo.
    agentRules: false,
};

export default nextConfig;
