/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@gullabs/react-flipbook', '@gullabs/flipbook-core'],
  // Quality lives at the monorepo root (eslint.config.mjs + pnpm lint).
  typescript: {
    // Root quality:ci already typechecks; keep Next's own pass as a double-check.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
