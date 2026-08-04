import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      "@mupdf-wasm?url": `${new URL(
        "./node_modules/mupdf/dist/mupdf-wasm.wasm",
        import.meta.url,
      ).pathname}?url`,
    },
  },
  optimizeDeps: {
    include: ["mupdf"],
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
