import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const webRoot = path.dirname(fileURLToPath(import.meta.url));

function copyPdfjsWasm() {
  const src = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "wasm");
  const dest = path.join(webRoot, "public", "pdfjs", "wasm");
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name.endsWith(".wasm") || name.endsWith(".js")) {
      fs.copyFileSync(path.join(src, name), path.join(dest, name));
    }
  }
}

copyPdfjsWasm();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: "es",
  },
  optimizeDeps: {
    include: ["pdfjs-dist"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
