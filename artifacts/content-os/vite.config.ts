import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

function resolvePort(required: boolean): number | undefined {
  const rawPort = process.env.PORT;

  if (!rawPort) {
    if (required) {
      throw new Error(
        'PORT environment variable is required to run the dev server but was not provided.',
      );
    }
    return undefined;
  }

  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  return port;
}

const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig(async ({ command }) => {
  const port = resolvePort(command === 'serve');

  // Replit-specific plugins are loaded only when running inside Replit
  const replitPlugins: any[] = [];
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
  ) {
    try {
      const [errorModal, cartographer, devBanner] = await Promise.all([
        import('@replit/vite-plugin-runtime-error-modal').then((m) => m.default()),
        import('@replit/vite-plugin-cartographer').then((m) =>
          m.cartographer({ root: path.resolve(import.meta.dirname, '..') }),
        ),
        import('@replit/vite-plugin-dev-banner').then((m) => m.devBanner()),
      ]);
      replitPlugins.push(errorModal, cartographer, devBanner);
    } catch {
      // Replit plugins not available — running outside Replit, which is fine
    }
  }

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), ...replitPlugins],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
      // Proxy API calls to the Express server during development
      proxy: {
        '/api': {
          target: `http://localhost:${process.env.API_PORT ?? 8080}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
