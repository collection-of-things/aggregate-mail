import { browserAccess, browserConfiguration } from "./browser-access.js";

// Imported before storage: invalid browser setup must not open or create a store.
const configuration = process.env.MAIL_DESKTOP_TOKEN ? undefined : browserConfiguration(process.env);
export const browserGate = configuration && browserAccess(configuration.password, configuration.origin);

export const browserPort = configuration?.port || 3001;
