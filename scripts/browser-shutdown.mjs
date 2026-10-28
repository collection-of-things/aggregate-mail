// A failed drain must leave the process alive so the deployment cannot advance.
export function browserShutdown({ ready, exit, warn }) {
  let stopping = false;
  return async () => {
    if (stopping) return;
    stopping = true;
    let runtime;
    try {
      runtime = await ready;
      await runtime.quiesceMail(30_000);
      await new Promise((resolve, reject) => runtime.server.close(error => error ? reject(error) : resolve()));
      exit(0);
    } catch {
      runtime?.resumeMail();
      stopping = false;
      warn("Browser shutdown did not drain. Deployment must not continue.");
    }
  };
}
