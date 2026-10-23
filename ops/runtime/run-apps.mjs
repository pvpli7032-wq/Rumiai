import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceEnvironment, projectRoot} from './environment.mjs';

export function runApplications(mode = 'start') {
  if (!['start', 'dev'].includes(mode)) throw Error('Expected start or dev.');
  loadWorkspaceEnvironment(mode === 'dev');
  const env = {...process.env, NODE_ENV: mode === 'dev' ? 'development' : 'production'};
  const ports = {web: env.WEB_PORT || '3010', admin: env.ADMIN_PORT || '3011', api: env.API_PORT || '3012'};
  env.INTERNAL_API_ORIGIN ||= `http://127.0.0.1:${ports.api}`;
  env.ADMIN_API_INTERNAL_URL ||= env.INTERNAL_API_ORIGIN;
  env.INTERNAL_ADMIN_ORIGIN ||= `http://127.0.0.1:${ports.admin}`;
  const next = path.join(projectRoot, 'node_modules/next/dist/bin/next');
  const children = [];
  let stopping = false;
  function stop(signal = 'SIGTERM', code = 0) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) if (child.exitCode === null) child.kill(signal);
  }
  for (const app of ['api', 'admin', 'web', 'worker']) {
    const args = app === 'worker'
      ? ['--import', 'tsx', path.join(projectRoot, 'apps/worker/src/index.ts')]
      : [next, mode, '--hostname', '127.0.0.1', '--port', ports[app]];
    const child = spawn(process.execPath, args, {
      cwd: path.join(projectRoot, 'apps', app), env, stdio: 'inherit', windowsHide: true,
    });
    children.push(child);
    child.once('error', error => {
      console.error(`${app} startup failed:`, error.message);
      stop('SIGTERM', 1);
    });
    child.once('exit', (code, signal) => {
      if (!stopping) {
        console.error(`${app} exited: ${signal || code}`);
        stop('SIGTERM', code || 1);
      }
    });
  }
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  return {stop, children};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runApplications(process.argv[2] || 'start');
}
