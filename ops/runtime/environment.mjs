import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import nextEnv from '@next/env';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function resolveWorkspaceDatabaseUrl(value,root=projectRoot) {
  if(!value?.startsWith('file:'))return value;
  const absolute=fileURLToPath(new URL(value,pathToFileURL(path.join(root,'database/schema.prisma'))));
  // Prisma 5 on Windows expects file:C:/... rather than file:///C:/....
  return `file:${absolute.replaceAll('\\','/')}`;
}

/** Keep configuration and SQLite resolution independent of each app's cwd. */
export function loadWorkspaceEnvironment(development = process.env.NODE_ENV !== 'production', root = projectRoot) {
  const explicitDatabaseUrl = process.env.DATABASE_URL;
  // Next may have already marked env loading as processed before an app config
  // imports this shared runtime. forceReload makes this explicit workspace load
  // happen anyway; @next/env still keeps values already present in process.env
  // (including deployment-injected values) ahead of file values.
  nextEnv.loadEnvConfig(root, development, console, true);
  process.env.RUMIAI_PROJECT_ROOT = root;
  // @next/env caches its first process snapshot. A later caller may provide a
  // deliberate process-level override, so restore the value observed at this
  // call boundary before normalizing it.
  if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl;
  const value = process.env.DATABASE_URL;
  if (value?.startsWith('file:')) {
    process.env.DATABASE_URL = resolveWorkspaceDatabaseUrl(value, root);
  }
  return projectRoot;
}
