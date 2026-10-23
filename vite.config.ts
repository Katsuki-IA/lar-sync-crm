import {defineConfig} from '@lovable.dev/vite-tanstack-config';
import {loadEnv} from 'vite';

// Dedicated OY candidate. Runtime blocked until server setup is explicitly authorized.
// Publishable key comes from the existing build environment (process env or project .env),
// never the service-role key.
const buildMode = process.env.NODE_ENV === 'development' ? 'development' : 'production';
const fileEnv = loadEnv(buildMode, process.cwd(), ['SUPABASE_PUBLISHABLE_KEY']);
const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || fileEnv.SUPABASE_PUBLISHABLE_KEY)?.trim();
if (!publishableKey) {
  throw new Error('Build bloqueado: SUPABASE_PUBLISHABLE_KEY ausente no ambiente de compilação.');
}

export default defineConfig({envDefine:false,tanstackStart:{server:{entry:'server'}},
 vite:{envDir:false,define:{
  'import.meta.env.HUB_PRODUCTION_CANDIDATE':true,
  'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://tswdxgefmhjvjwafaxjl.supabase.co'),
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(publishableKey)
 }}});
