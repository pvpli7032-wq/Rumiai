import { PrismaClient } from '@prisma/client';
import { logWarning } from '@rumiai/backend/infrastructure/logging/logger';

/**
 * Global declaration to prevent multiple PrismaClient instances
 * during Next.js Hot Module Replacement (HMR) in development mode.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPragmas: Promise<void> | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma's rendered errors may include user content. Routes log safe error metadata.
    log: [],
  });

/**
 * SQLite defaults are too strict for concurrent writers.
 *
 * With the rollback journal, a single writer locks the whole database and other
 * connections fail immediately rather than waiting, so genuinely concurrent requests
 * — six simultaneous check-ins, say — can all lose. WAL lets readers continue during
 * a write, and busy_timeout makes a blocked writer wait its turn instead of erroring
 * out. Without these, the daily check-in awarded nothing at all under contention on
 * Linux, while happening to serialise cleanly on Windows.
 *
 * Order matters: `busy_timeout` must be set before switching the journal mode, because
 * the switch itself needs an exclusive lock. Doing it the other way round made the
 * switch fail outright whenever another connection held the file — which is exactly
 * what a 116-page production build does — and every later query then ran on the
 * rollback journal and timed out (P1008). The switch is also retried with backoff,
 * and `scripts/start-production.mjs` sets WAL on the file before the server starts,
 * so a fresh connection usually finds the file already in WAL.
 */
async function switchToWal(client: PrismaClient, attempts = 4): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await client.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  throw lastError;
}

function applyPragmas(client: PrismaClient): Promise<void> {
  return (async () => {
    try {
      // $queryRaw, not $executeRaw: PRAGMA returns a row, and SQLite rejects a
      // statement that yields results when run through execute.
      await client.$queryRawUnsafe('PRAGMA busy_timeout = 8000;');
      await switchToWal(client);
      await client.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
    } catch (error) {
      // A non-SQLite datasource simply will not have these; that is not fatal.
      const safeName=error instanceof Error&&/^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(error.name)?error.name:'UnknownError';
      const code=(error as {code?:unknown}|null)?.code;
      logWarning('sqlite_pragmas_failed',{errorName:safeName,...(typeof code==='string'&&/^[A-Z0-9_]{1,80}$/.test(code)?{errorCode:code}:{})});
    }
  })();
}

export const pragmasReady = globalForPrisma.prismaPragmas ?? applyPragmas(db);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaPragmas = pragmasReady;
}
