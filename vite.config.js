import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages: https://<konto>.github.io/<repository-name>/
// Das Repository heißt "chat", daher der Basispfad /chat/.
export default defineConfig({
  base: process.env.VITE_BASE || '/chat/',
  plugins: [react()],
});
