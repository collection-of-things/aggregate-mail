// Load only the APIs this client uses, rather than the complete API catalogue.
import { auth, gmail } from "googleapis/build/src/apis/gmail/index.js";
import { calendar } from "googleapis/build/src/apis/calendar/index.js";

export const google = { auth, gmail, calendar };
export type { calendar_v3 } from "googleapis/build/src/apis/calendar/index.js";
export type { gmail_v1 } from "googleapis/build/src/apis/gmail/index.js";
