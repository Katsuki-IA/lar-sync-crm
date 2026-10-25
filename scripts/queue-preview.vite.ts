import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({plugins:[react(),tailwind()],resolve:{alias:{'@':path.resolve(__dirname,'../src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://example.invalid'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('local-fixture')},server:{host:'127.0.0.1',port:4187,strictPort:true}});
