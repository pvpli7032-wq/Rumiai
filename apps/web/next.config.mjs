import {fileURLToPath} from 'node:url';
import {loadWorkspaceEnvironment} from '../../ops/runtime/environment.mjs';

loadWorkspaceEnvironment();

const apiOrigin=process.env.INTERNAL_API_ORIGIN || 'http://127.0.0.1:3012';
const adminOrigin=process.env.INTERNAL_ADMIN_ORIGIN || 'http://127.0.0.1:3011';
export default {
  reactStrictMode:true,
  outputFileTracingRoot:fileURLToPath(new URL('../../',import.meta.url)),
  transpilePackages:['@rumiai/ui','@rumiai/contracts'],
  distDir:process.env.NEXT_DIST_DIR || '.next-build',
  async rewrites(){return {beforeFiles:[
    {source:'/api/:path*',destination:`${apiOrigin}/api/:path*`},
    {source:'/uploads/:name',destination:`${apiOrigin}/api/uploads/:name`},
    {source:'/admin-assets/:path*',destination:`${adminOrigin}/admin-assets/:path*`},
    {source:'/admin/:path*',destination:`${adminOrigin}/admin/:path*`},
  ]};},
  async headers(){return [{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache'}]},{source:'/manifest.webmanifest',headers:[{key:'Cache-Control',value:'no-cache'}]}];},
  images:{localPatterns:[{pathname:'/brand/**'}],remotePatterns:[]},
};
