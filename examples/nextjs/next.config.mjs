/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@gullabs/react-flipbook', '@gullabs/flipbook-core'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
