import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    // Las copias de revisión y respaldos locales no son pruebas del producto.
    exclude: [...configDefaults.exclude, '**/*.local/**'],
    // Las pruebas jamás deben alcanzar Supabase real.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    setupFiles: ['./src/test/sinProduccion.js'],
  },
}));
