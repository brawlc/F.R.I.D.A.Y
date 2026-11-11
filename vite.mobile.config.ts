import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({ root:resolve('frontend/mobile'),base:'/mobile/',define:{'import.meta.env.VITE_FRIDAY_API_MODE':JSON.stringify('private-mobile')},plugins:[react()],build:{outDir:resolve('mobile-dist'),emptyOutDir:true},server:{host:'127.0.0.1'} });
