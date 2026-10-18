import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves the site at https://<user>.github.io/gambit/, so builds (and `vite preview`
// of a build) use that base. Local dev stays at /. Override with BASE=/ for hosting at a domain root.
export default defineConfig(({ command, isPreview }) => ({
  base: process.env.BASE ?? (command === 'build' || isPreview ? '/gambit/' : '/'),
  plugins: [react(), tailwindcss()],
}));
