import path from 'node:path';

/** Keep backups outside versioned releases when a persistent directory is configured. */
export function backupDirectory() {
  return path.resolve(process.env.BACKUPS_DIRECTORY || path.join('prisma', 'backups'));
}
