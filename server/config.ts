import { existsSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from "node:fs";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { get, put, transaction } from "./store.js";

const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OPENAI_API_KEY", "TYPESAFE_API_KEY", "TYPESAFE_PROVIDER"] as const;
type Settings = Partial<Record<(typeof names)[number], string>>;
const inherited = new Set(Object.keys(process.env));
const configPath = process.env.MAIL_CONFIG_PATH || ".env";

function legacySettings() {
  const text = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  return { text, values: parseEnv(text) };
}

function withoutManagedSettings(text: string, values: ReturnType<typeof parseEnv>) {
  // Preserve unrelated lines verbatim, including multiline quoted values. Check
  // the result with Node's parser before allowing any plaintext cleanup.
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const retained: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let entry = lines[i];
    const match = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*([\s\S]*)$/.exec(entry);
    if (!match) { retained.push(entry); continue; }
    const quote = match[2][0];
    if (["'", '"', "`"].includes(quote)) {
      let value = match[2].slice(1);
      while (!value.includes(quote) && i + 1 < lines.length) {
        const next = lines[++i];
        entry += next;
        value += next;
      }
      if (!value.includes(quote)) throw new Error("Cannot safely migrate the connection settings file.");
    }
    if (!names.includes(match[1] as (typeof names)[number])) retained.push(entry);
  }
  const cleaned = retained.join("");
  const expected = Object.fromEntries(Object.entries(values).filter(([name]) => !names.includes(name as (typeof names)[number])));
  if (!isDeepStrictEqual({ ...parseEnv(cleaned) }, expected)) throw new Error("Cannot safely migrate the connection settings file.");
  return cleaned;
}

function persist(settings: Settings) {
  transaction(() => {
    put("config", "connection", settings);
    if (!isDeepStrictEqual(get("config", "connection"), settings)) throw new Error("Encrypted connection settings could not be verified.");
  });
  // A committed encrypted readback is required before plaintext is removed.
  if (!isDeepStrictEqual(get("config", "connection"), settings)) throw new Error("Encrypted connection settings could not be verified.");
}

function cleanLegacy(text: string, cleaned: string) {
  if (text === cleaned) return;
  // Never place the original credentials in a backup or temporary file.
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, cleaned);
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(temporary);
    throw error;
  }
  closeSync(descriptor);
  try { renameSync(temporary, configPath); }
  catch (error) { unlinkSync(temporary); throw error; }
}

export function loadConfiguration() {
  const legacy = legacySettings();
  const cleaned = withoutManagedSettings(legacy.text, legacy.values);
  const saved = get("config", "connection");
  const settings: Settings = { ...saved };
  for (const name of names) if (settings[name] === undefined && legacy.values[name] !== undefined) settings[name] = legacy.values[name];
  if (Object.keys(settings).length && !isDeepStrictEqual(saved, settings)) persist(settings);
  cleanLegacy(legacy.text, cleaned);
  for (const [name, value] of Object.entries({ ...legacy.values, ...settings })) {
    if (!inherited.has(name)) process.env[name] = value;
  }
}

export function saveConfiguration(updates: Settings) {
  const legacy = legacySettings();
  const cleaned = withoutManagedSettings(legacy.text, legacy.values);
  const settings: Settings = { ...get("config", "connection") };
  for (const name of names) {
    if (settings[name] === undefined && legacy.values[name] !== undefined) settings[name] = legacy.values[name];
    if (updates[name]) settings[name] = updates[name];
  }
  persist(settings);
  cleanLegacy(legacy.text, cleaned);
  for (const name of names) if (!inherited.has(name) && settings[name] !== undefined) process.env[name] = settings[name];
}
