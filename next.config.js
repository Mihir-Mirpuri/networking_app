/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

module.exports = nextConfig;
