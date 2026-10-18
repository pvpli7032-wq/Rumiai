// Keep local/CI builds independent of the user's global telemetry config store.
// Explicit operator settings still take precedence.
import { fileURLToPath } from 'node:url';
process.env.NEXT_TELEMETRY_DISABLED ??= '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  async rewrites() {
    return {
      beforeFiles: [{ source: '/uploads/:name', destination: '/api/uploads/:name' }],
      // Compatibility window for the /api/admin migration (A3). Administration
      // handlers now live under /api/admin/<domain>; these rewrites keep the old
      // prefixes answering for callers that have not moved yet. Remove them —
      // together with the matching legacy roots in
      // src/lib/operations/maintenance-routing.ts — once nothing calls the old
      // prefixes any more.
      afterFiles: [
        { source: '/api/finance/:path*', destination: '/api/admin/finance/:path*' },
        { source: '/api/moderation/:path*', destination: '/api/admin/moderation/:path*' },
        { source: '/api/accounts/management', destination: '/api/admin/accounts' },
        { source: '/api/accounts/management/:path*', destination: '/api/admin/accounts/:path*' },
        { source: '/api/characters/management', destination: '/api/admin/characters' },
        { source: '/api/characters/management/:path*', destination: '/api/admin/characters/:path*' },
        { source: '/api/circles/management', destination: '/api/admin/circles' },
        { source: '/api/circles/management/:path*', destination: '/api/admin/circles/:path*' },
      ],
    };
  },
  // Administration used to live at the top level (/finance, /moderation). It now
  // sits under /admin as its own route group. Temporary redirects until a release
  // has shipped and external links have been updated.
  async redirects() {
    return [
      { source: '/finance', destination: '/admin/finance', permanent: false },
      { source: '/finance/:path*', destination: '/admin/finance/:path*', permanent: false },
      { source: '/moderation', destination: '/admin/moderation', permanent: false },
      { source: '/moderation/:path*', destination: '/admin/moderation/:path*', permanent: false },
    ];
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
