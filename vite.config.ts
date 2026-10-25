import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pdfAssets } from "./scripts/pdf-assets";
export default defineConfig({
  plugins: [react(), pdfAssets()],
  server: {
    proxy: { "/api": "http://127.0.0.1:3001" },
    watch: { ignored: ["**/release/**", "**/.desktop/**"] },
  },
});
