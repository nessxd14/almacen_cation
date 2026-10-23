import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    // Las copias de revisión y respaldos locales no son pruebas del producto.
    exclude: [...configDefaults.exclude, '**/*.local/**'],
  },
}));
