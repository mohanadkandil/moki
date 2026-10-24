import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workshopApi } from "./server/workshop-api";

export default defineConfig({
  root: "web",
  plugins: [react(), workshopApi()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
