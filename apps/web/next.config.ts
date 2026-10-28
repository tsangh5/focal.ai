import type { NextConfig } from "next";

// React's development build uses eval() to rebuild server error stacks; production never does.
const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    // Pragmatic CSP for a hackathon build: 'unsafe-inline' in script-src /
    // style-src covers Next's hydration scripts and injected styles. A
    // nonce-based CSP is post-hackathon work.
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${devEval}`,
      "style-src 'self' 'unsafe-inline'",
      // Qloo serves entity artwork (posters, covers, venue photos) from this host.
      "img-src 'self' data: https://images.qloo.com",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Emits .next/standalone for the Docker runner stage. No effect on `next start`.
  output: "standalone",
  transpilePackages: ["@focal-ai/core", "@focal-ai/qloo", "@focal-ai/mcp"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.qloo.com", pathname: "/i/**" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // OAuth discovery for the hosted MCP endpoint (RFC 9728 / RFC 8414).
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/mcp", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/authorization-server" },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
