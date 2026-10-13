import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {checkSiteHealth} from '../scripts/check-site-health.mjs';

test('health check reads the real HTTP response, rejects bad results and times out', async () => {
  const server = http.createServer((req,res) => {
    if (req.url === '/slow') return;
    if (req.url === '/down') {res.writeHead(503);res.end('PRIVATE_CONTENT_MUST_NOT_BE_LOGGED');return;}
    res.setHeader('Content-Type','application/json');
    res.end(req.url === '/good' ? '[]' : '{"unexpected":true}');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await checkSiteHealth(base+'/good'),{healthy:true});
    const down = await checkSiteHealth(base+'/down');
    assert.deepEqual(down,{healthy:false,reason:'HTTP_STATUS',status:503});
    assert(!JSON.stringify(down).includes('PRIVATE_CONTENT'));
    assert.deepEqual(await checkSiteHealth(base+'/wrong'),{healthy:false,reason:'INVALID_PAYLOAD'});
    assert.deepEqual(await checkSiteHealth(base+'/slow',100),{healthy:false,reason:'TIMEOUT'});
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
