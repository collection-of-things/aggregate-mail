import { build } from "esbuild";
await build({ entryPoints: ["src/phone-auth.ts"], outfile: "dist/auth-passkey.js", bundle: true, platform: "browser", target: "es2022", minify: true });
