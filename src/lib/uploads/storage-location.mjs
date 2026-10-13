import path from 'node:path';

// Server-only configuration allows recovery into a new directory without replacing live files.
export const uploadDirectory = (root = process.cwd()) => path.resolve(root, process.env.UPLOADS_DIRECTORY?.trim() || 'public/uploads');
