import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';
const mock=path.resolve(__dirname,'tasks-preview-mocks.tsx');
export default defineConfig({optimizeDeps:{entries:['scripts/tasks-preview.html']},plugins:[react(),tailwind()],resolve:{alias:[
 ...['@/hooks/use-crm-user','@/hooks/use-active-empresa','@tanstack/react-router','./modules','./administration'].map(find=>({find,replacement:mock})),
 {find:'@',replacement:path.resolve(__dirname,'../src')},
]},server:{host:'127.0.0.1',port:4190,strictPort:true,watch:{ignored:['**/.output/**','**/.nitro/**']}}});
