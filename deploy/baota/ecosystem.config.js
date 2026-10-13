const path = require('node:path');

const root = path.resolve(__dirname, '../..');

module.exports = {
  apps: [{
    name: 'khui-ai',
    cwd: root,
    script: path.join(root, 'node_modules/next/dist/bin/next'),
    args: 'start --hostname 127.0.0.1 --port 3000',
    interpreter: process.execPath,
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production',
      NEXT_DIST_DIR: '.next-build',
      NEXT_PUBLIC_SITE_URL: 'https://lh.y-98.cn',
      DISABLE_MOCK_AI: 'true',
      ALLOW_SIMULATED_PURCHASES: 'false',
      EZFP_ENABLED: 'false',
      AI_BUDGET_CIRCUIT_BREAKER: 'false',
    },
  }],
};
