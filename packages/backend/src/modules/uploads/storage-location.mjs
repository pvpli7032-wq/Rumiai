import path from 'node:path';

// Server-only configuration allows recovery into a new directory without replacing live files.
export const uploadDirectory = (root = process.env.RUMIAI_PROJECT_ROOT || process.cwd()) => path.resolve(root, process.env.UPLOADS_DIRECTORY?.trim() || 'apps/web/public/uploads');
