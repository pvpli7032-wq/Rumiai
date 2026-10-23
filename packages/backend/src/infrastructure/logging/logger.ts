/**
 * Minimal structured logging for API routes.
 *
 * Every route used to end in a bare `catch {}` that discarded the error before
 * returning a generic 500, so a production failure left nothing to investigate —
 * a unique-constraint bug in the profile endpoint was only found by probing the
 * running server. Responses are unchanged; this only makes the cause recoverable.
 *
 * Output is one JSON object per line so a log collector can parse it. In
 * development it stays readable on a single line too.
 */

type Fields = Record<string, unknown>;

function serialiseError(error: unknown): Fields {
  if (error instanceof Error) {
    return {
      errorName: /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(error.name) ? error.name : 'Error',
      // Prisma attaches a code (P2002 and friends) that says far more than the message.
      ...(typeof (error as unknown as { code?: unknown }).code === 'string' && /^[A-Z0-9_]{1,80}$/.test((error as unknown as { code: string }).code)
        ? { errorCode: (error as unknown as { code: string }).code }
        : {}),
    };
  }
  return { errorName: 'UnknownError' };
}

function emit(level: 'error' | 'warn' | 'info', message: string, fields: Fields) {
  const line = JSON.stringify({ level, message, at: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * Log an unexpected failure in a route handler. `route` should identify the
 * handler, e.g. 'PUT /api/users/me'.
 */
export function logRouteError(route: string, error: unknown, fields: Fields = {}) {
  emit('error', 'route_error', { route, ...fields, ...serialiseError(error) });
}

export function logWarning(message: string, fields: Fields = {}) {
  emit('warn', message, fields);
}
