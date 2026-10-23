import {fileURLToPath} from 'node:url';
import {loadWorkspaceEnvironment} from '../../ops/runtime/environment.mjs';

process.env.NEXT_TELEMETRY_DISABLED ??= '1';
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
loadWorkspaceEnvironment();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  distDir: process.env.NEXT_DIST_DIR || '.next-api',
};

export default nextConfig;
