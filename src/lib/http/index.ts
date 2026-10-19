/**
 * Route-layer helpers: one auth entry, one error body, one cache policy.
 * Intentionally small — this is not a framework, only the shared shape the
 * administration routes already implemented ten times over.
 */
export {privateHeaders, apiError, unauthorized, forbidden, badRequest, jsonError, type ApiErrorBody} from './errors';
export {requireUser, requireAdmin, type AdminAccess, type AuthenticatedUser} from './auth';
export {readJsonBody, type JsonBodyOptions, type JsonBodyResult} from './body';
