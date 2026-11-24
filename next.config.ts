import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The Redis client for rate limits (src/lib/redis.ts) runs as plain Node, unbundled.
  serverExternalPackages: ["ioredis"],
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
    // src/proxy.ts runs before every request, and Next keeps only this much
    // of a request body for it. Video uploads are up to 50 MB (see
    // MAX_VIDEO_BYTES); the default 10 MB would cut them off.
    proxyClientMaxBodySize: "52mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
