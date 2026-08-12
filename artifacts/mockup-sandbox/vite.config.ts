import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { cartographer } from "@replit/vite-plugin-cartographer";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

function resolvePort(required: boolean): number | undefined {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    if (required) {
      throw new Error(
        "PORT environment variable is required to serve the mockup sandbox",
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

export default defineConfig(({ command }) => {
  const port = resolvePort(command === "serve");

  return {
    base: process.env.BASE_PATH ?? "/",
    plugins: [
      mockupPreviewPlugin(),
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
