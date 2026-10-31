// `npm run dev:demo`: the browser target with made-up accounts and mail, for
// interface work without connecting a real account. Everything lives in
// .data-demo; delete that folder to start over with fresh mail.
import path from "node:path";

// Set before the store loads. The demo never opens another mail store, and
// fake mail never reaches an AI sorter or Google, whatever the shell exports.
const dataDir = path.resolve(".data-demo");
process.env.MAIL_DATA_DIR = dataDir;
process.env.MAIL_CONFIG_PATH = path.join(dataDir, "settings.env");
process.env.APP_URL = "http://127.0.0.1:5180";
for (const name of ["MAIL_DATA_KEY", "MAIL_DESKTOP_TOKEN", "MAIL_RENDERER_ORIGIN", "OPENAI_API_KEY", "TYPESAFE_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])
  delete process.env[name];

const { installDemoMailbox } = await import("./demo-mail.js");
installDemoMailbox(dataDir);
// Importing the service starts it on port 3001, where Vite sends /api.
const { syncMail } = await import("./index.js");
const { errors } = await syncMail();
if (errors.length) console.error("Demo sync failed:", errors.join("; "));
else console.log(`Demo inbox ready at ${process.env.APP_URL}`);
