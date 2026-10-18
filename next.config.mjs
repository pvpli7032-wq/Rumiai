// Keep local/CI builds independent of the user's global telemetry config store.
// Explicit operator settings still take precedence.
import { fileURLToPath } from 'node:url';
process.env.NEXT_TELEMETRY_DISABLED ??= '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  // Uploads are stored outside /public, so the public path is rewritten to the
  // authenticated handler. This is a real mapping, not a compatibility shim.
  async rewrites() {
    return {
      beforeFiles: [{ source: '/uploads/:name', destination: '/api/uploads/:name' }],
    };
  },
  // Production builds go to .next-build so `npm run build` never wipes the dev
  // server's chunks out from under a running `npm run dev`. (npm sets
  // npm_lifecycle_event to the script name; cross-platform, no extra dep.)
  //
  // NEXT_DIST_DIR overrides it entirely. The stub-AI verification scripts start their
  // own `next dev` in this same directory, and sharing .next with an already-running
  // server corrupts its route manifest — the running server then 404s on routes it had
  // served a moment earlier.
  distDir:
    process.env.ISOLATED_BUILD_DIR?.trim() ||
    process.env.NEXT_DIST_DIR ||
    (['build', 'start'].includes(process.env.npm_lifecycle_event ?? '') ? '.next-build' : '.next'),
  async headers() { return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }, { source: '/manifest.webmanifest', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }, { source: '/uploads/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] }]; },
  images: {
    // Authenticated uploads must never be copied into the public image-optimizer cache.
    localPatterns: [{ pathname: '/brand/**' }],
    // No remote host is whitelisted: every avatar is either an uploaded file or a
    // local /brand asset. Adding one back requires an actual caller.
    remotePatterns: [],
  },
};

export default nextConfig;
