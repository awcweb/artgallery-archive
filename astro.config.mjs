// @ts-check
import { defineConfig } from 'astro/config';

// Deployed to GitHub Pages as a project site: https://awcweb.github.io/artgallery-archive/
export default defineConfig({
  site: 'https://awcweb.github.io',
  base: '/artgallery-archive',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
