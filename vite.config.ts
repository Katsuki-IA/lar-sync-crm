import {defineConfig} from '@lovable.dev/vite-tanstack-config';

// Dedicated OY candidate. Runtime blocked until server setup is explicitly authorized.
export default defineConfig({envDefine:false,tanstackStart:{server:{entry:'server'}},
 vite:{envDir:false,define:{
  'import.meta.env.HUB_PRODUCTION_CANDIDATE':true,
  'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://tswdxgefmhjvjwafaxjl.supabase.co'),
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_f9vUJpnxHks2Xh2_bVKlUA_OQ0NhYAS')
 }}});

