import type { ImapFlow } from "imapflow";

// Guard the pinned protocol callback before ImapFlow expands ESEARCH ranges.
// Wire/line size limits still apply before these parsed tokens reach us.
const MAX_RESULTS = 10_000;
type Token = { value?: string } | Token[];
type Response = { attributes?: Token[] };
type Handler = (response: Response) => Promise<unknown>;
type Options = { untagged?: Record<string, Handler> };
type Connection = { exec(command: string, attributes: unknown, options?: Options): Promise<unknown> };

export function guardSearchExpansion(client: ImapFlow) {
  const connection = client as unknown as Connection;
  const exec = connection.exec;
  connection.exec = function (command, attributes, options) {
    if (!/^(?:UID )?SEARCH$/i.test(command) || !options?.untagged) return exec.call(this, command, attributes, options);
    let remaining = MAX_RESULTS;
    const consume = (count: number) => {
      if (!Number.isSafeInteger(count) || count < 0 || count > remaining) {
        client.close();
        throw new Error("IMAP search exceeds the safe result limit. Narrow the search in your provider.");
      }
      remaining -= count;
    };
    const handlers = { ...options.untagged };
    for (const kind of ["SEARCH", "ESEARCH"]) {
      const handler = handlers[kind];
      if (!handler) continue;
      handlers[kind] = async response => {
        const tokens = response.attributes || [];
        if (kind === "SEARCH") consume(tokens.length);
        else for (let index = 0; index < tokens.length; index++) {
          const token = tokens[index];
          if (Array.isArray(token) || token.value?.toUpperCase() !== "ALL") continue;
          const range = tokens[++index];
          if (!range || Array.isArray(range) || !range.value) { consume(Infinity); continue; }
          for (const part of range.value.split(",")) {
            const ends = part.split(":");
            if (ends.length > 2 || ends.some(value => !/^[1-9]\d{0,9}$/.test(value) || Number(value) > 4294967295)) {
              consume(Infinity); continue;
            }
            consume(Math.abs(Number(ends[0]) - Number(ends.at(-1))) + 1);
          }
        }
        return handler(response);
      };
    }
    return exec.call(this, command, attributes, { ...options, untagged: handlers });
  };
}
