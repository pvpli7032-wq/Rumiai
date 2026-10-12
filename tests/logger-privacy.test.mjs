import test from 'node:test';
import assert from 'node:assert/strict';
import { logRouteError } from '../src/lib/logger.ts';

test('route errors remain traceable without raw content, credentials or rendered database inputs', () => {
  const lines = [], previous = console.error;
  console.error = value => lines.push(value);
  try {
    const error = Object.assign(new Error('PRIVATE_CHAT and password=SECRET_KEY'), { code: 'P2002' });
    error.stack = 'Error: PRIVATE_CHAT\n    at SECRET_KEY';
    logRouteError('POST /test', error);
    logRouteError('POST /test', 'SECRET_KEY');
    assert.equal(JSON.parse(lines[0]).errorCode, 'P2002');
    assert.equal(JSON.parse(lines[0]).route, 'POST /test');
    assert(!lines.join('').includes('PRIVATE_CHAT') && !lines.join('').includes('SECRET_KEY'));
  } finally { console.error = previous; }
});
