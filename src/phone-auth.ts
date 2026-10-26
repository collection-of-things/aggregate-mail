import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

// Capture and remove the invitation before rendering or making any network request.
let invite = location.pathname === "/auth/pair" ? location.hash.slice(1) : "";
if (location.hash) history.replaceState(null, "", location.pathname);
const status = document.getElementById("passkey-status");
const register = document.getElementById("passkey-register") as HTMLButtonElement | null;
const unlock = document.getElementById("passkey-unlock") as HTMLButtonElement | null;
let stopped = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const message = (value: string) => { if (status) status.textContent = value; };
const post = async <T>(route: string, body: unknown = {}): Promise<T> => {
  const response = await fetch(`/auth/passkey/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error("verification");
  return await response.json() as T;
};
const failed = () => { stopped = true; invite = ""; if (timer) clearTimeout(timer); message("Phone setup could not finish. Reconnect from Settings on your host."); };
const showClaim = (value: { code: string; approved: boolean }) => {
  const code = document.getElementById("pair-code");
  if (code) code.textContent = `Matching code: ${value.code}`;
  if (value.approved) { message("Host approved. Save a passkey using your phone's screen lock."); if (register) register.disabled = false; }
  else message("Compare this code with the host, then approve it there.");
};
const poll = async () => {
  if (stopped) return;
  try {
    const value = await post<{ code: string; approved: boolean }>("pair/status");
    if (stopped) return;
    showClaim(value);
    if (!value.approved) timer = setTimeout(() => void poll(), 2000);
  } catch { failed(); }
};
if (register) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(invite)) failed();
  else {
    const token = invite; invite = "";
    void post<{ code: string; approved: boolean }>("pair", { token }).then((value) => { showClaim(value); void poll(); }).catch(failed);
  }
  register.onclick = async () => {
    register.disabled = true;
    try {
      const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("register/options");
      const response = await startRegistration({ optionsJSON });
      await post("register/verify", response);
      stopped = true; location.replace("/");
    } catch { failed(); }
  };
}
if (unlock) unlock.onclick = async () => {
  unlock.disabled = true;
  try {
    message("Unlock with your phone's screen lock.");
    const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("login/options");
    const response = await startAuthentication({ optionsJSON });
    await post("login/verify", response);
    location.replace("/");
  } catch { message("Could not unlock. Try again, or reconnect this phone from Settings on the host."); unlock.disabled = false; }
};
window.addEventListener("pagehide", () => { stopped = true; invite = ""; if (timer) clearTimeout(timer); });
