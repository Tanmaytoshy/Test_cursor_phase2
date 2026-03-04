import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 'standalone' is only needed for Railway/Docker — Vercel handles output itself
  ...(process.env.RAILWAY_ENVIRONMENT ? { output: 'standalone' } : {}),
  turbopack: {
    root: '.',
  },
};

export default nextConfig;
