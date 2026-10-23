import {fileURLToPath} from 'node:url';
import {loadWorkspaceEnvironment} from '../../ops/runtime/environment.mjs';
loadWorkspaceEnvironment();
process.env.NEXT_TELEMETRY_DISABLED ??= '1';
const api = process.env.ADMIN_API_INTERNAL_URL?.trim() || 'http://127.0.0.1:3012';
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@rumiai/ui', '@rumiai/contracts'],
  distDir: process.env.NEXT_DIST_DIR || '.next-admin',
  assetPrefix: process.env.ADMIN_ASSET_PREFIX?.trim() || '/admin-assets',
  async rewrites() { return [
    {source: '/admin-assets/_next/:path*', destination: '/_next/:path*'},
    {source: '/uploads/:name', destination: `${api}/api/uploads/:name`},
    {source: '/api/:path*', destination: `${api}/api/:path*`},
  ]; },
};
export default nextConfig;
