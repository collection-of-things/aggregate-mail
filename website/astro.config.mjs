import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// Static landing page. The download and star counts are read in the browser
// straight from the public GitHub API, so the build needs no server. SITE_URL
// sets the canonical origin for og:url and the canonical link when deployed.
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  output: "static",
  server: { allowedHosts: [".trycloudflare.com"] },
  integrations: [preact()],
});
