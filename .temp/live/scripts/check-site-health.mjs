import path from 'node:path';
import {fileURLToPath} from 'node:url';

const site = 'https://lh.y-98.cn/api/characters';

/** Read-only: HTTPS, Next routing and the public database query must all work. */
export async function checkSiteHealth(url = site, timeoutMs = 10000) {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs), redirect: 'error'});
    if (response.status !== 200) return {healthy: false, reason: 'HTTP_STATUS', status: response.status};
    const data = await response.json();
    if (!Array.isArray(data)) return {healthy: false, reason: 'INVALID_PAYLOAD'};
    return {healthy: true};
  } catch (error) {
    return {healthy: false, reason: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'CONNECTION_OR_RESPONSE'};
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkSiteHealth();
  console.log(JSON.stringify({at: new Date().toISOString(), message: result.healthy ? 'site_health_ok' : 'site_health_failed', ...result}));
  if (!result.healthy) process.exitCode = 1;
}
