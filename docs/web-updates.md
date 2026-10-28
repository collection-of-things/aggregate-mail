# Stable-release web updates

The Linux updater implements [issue #109](https://github.com/collection-of-things/aggregate-mail/issues/109).
It installs published stable releases from the canonical repository. Branch
merges and tags without a published release do not deploy. Live activation,
source merge and publication remain held until the deployment owner clears them.

## Deployment path

1. `scripts/web-deploy.mjs` validates the latest stable release tag and package
   version, rejects downgrades and moved tags, and fetches the exact commit into
   its own repository. Automatic release tags may be newer than the committed
   package version; the existing installer contract stamps only the isolated
   package and lock roots before verification. It installs dependencies, runs
   serial tests, builds the
   web app and probes a synthetic startup in a separate release directory.
   Build children receive no mail credentials. Releases without managed
   shutdown support are rejected.
2. Managed browser startup installs a drain signal. It stops new mail admission
   and waits for existing work before exiting. Drain failure leaves the process
   alive. Desktop startup, encryption, authentication and private routes retain
   their existing behavior. A local probe receives the public deployed revision.
3. Both releases must declare the same profile-format generation for automatic
   switching or rollback. The updater pins accepted tags to commits and never
   automatically downgrades. It switches current only after the old service
   stops successfully, checks the replacement revision, and retains previous.
   Failed startup restores the old service. Incomplete switches require recovery;
   failed revisions require an explicit retry. Profiles and credentials stay
   outside this operation.
4. Linux user-systemd templates bound updater memory, swap, wall time and
   descendants. The browser service cannot be force-killed after a failed drain.
   Template installation remains an operator action while activation is held.
5. Synthetic tests cover release selection, build failures, failed drains,
   revision mismatch, rollback, interrupted switches and repeated attempts.
   The startup test uses a fresh encrypted profile and generated test secrets.
   It checks the local gate and exit after draining without reading saved mail.

Rollback restores source and service only. Database changes cannot be undone by
source rollback; incompatible migrations require operator recovery. Retain all
release directories until an operator removes them.

The source and service rollback requires matching `webDeployment.profile`
generations. Maintainers must increment this package marker before introducing
any profile change that older releases cannot safely read or write. The
`webDeployment.protocol` marker identifies managed-startup support. Old releases
without this marker are rejected before the service stops.

## Prepare an installation without activating it

Requirements: Linux with a user systemd manager and cgroup v2 memory/swap
controllers, Git, tar, npm and Node 24.22.1 or newer 24.x. The user must already
have access to the existing persistent OS credential store. A user service
without that store must stop; do not replace its key or use a plaintext fallback.

1. Review and copy `scripts/web-deploy.mjs` to
   `~/.local/lib/emc2-web/web-deploy.mjs`. Keep this control script outside the
   release directories; replacing it is an explicit operator action.
2. Copy `scripts/systemd/emc2-web*` to `~/.config/systemd/user/`. Replace
   `@NODE@` with the absolute Node 24 executable and `@NODE_BIN@` with its bin
   directory. These are templates, not directly installable units. Use private
   directories (0700) and files (0600). Do not enable or start them under the hold.
3. Supply the existing host recovery passphrase through a secret manager into
   the protected launch environment `~/.config/emc2/web.env` (0600). Set the
   existing absolute `MAIL_DATA_DIR`. Keep that profile and `MAIL_CONFIG_PATH`
   outside `~/.local/share/emc2-web`. Externally managed profiles must retain
   their original `MAIL_DATA_KEY`; OS-managed profiles use their existing store.
   Never paste these values into commands, issue records or the repository.
4. Keep the browser service and updater on the same `MAIL_WEB_PORT` (3001 by
   default). Custom ports need both the protected service environment and the
   updater unit changed. Preserve the existing private phone route and account
   settings. This updater never edits routes or enrolls devices.
5. Confirm that the first selected stable release includes managed-deployment
   support and is compatible with the existing profile. A first deployment has
   no previous source for rollback. Replacing a transient service, changing its
   profile path and taking a profile backup are separate operator steps before
   activation. Do not run two processes on the same profile or port.

## Activate only after the hold is cleared

After the owner approves the prepared installation and profile compatibility:

```sh
systemctl --user daemon-reload
systemd-analyze --user verify emc2-web.service emc2-web-update.service
systemctl --user start emc2-web-update.service
node ~/.local/lib/emc2-web/web-deploy.mjs status
systemctl --user enable emc2-web.service emc2-web-update.timer
systemctl --user start emc2-web-update.timer
systemctl --user is-enabled emc2-web.service emc2-web-update.timer
systemctl --user list-timers emc2-web-update.timer
```

Use the same Node 24 executable for status and recovery commands. Confirm the
reported revision matches the published tag's commit and the localhost `/auth`
response carries matching `X-Emc2-Revision` and `X-Emc2-Browser: 1` headers.
Check the private phone route separately. An enabled timer is not proof of
native phone authentication or OS credential-store recovery. Host restart
persistence also depends on the user manager's login/linger policy; changing
that policy requires operator scope.

The updater checks five minutes after boot, then fifteen minutes after each
completed check, with up to one minute of jitter. It refuses updates if its
3 GiB memory limit, disabled swap or 20 minute service deadline is unavailable.
All build descendants share the updater cgroup. The browser service gets a
45 second stop window and no forced kill: a failed drain blocks switching.
The stable updater polls GitHub's public release API without a token. Network,
rate-limit and build errors leave the running service intact.

## Failure and recovery

- `status` reports current/previous receipts, a failed release and whether a
  switch is pending. Each receipt contains only public source/build identities
  and the profile generation. It does not contain profile or secret values.
- A failed release is not retried automatically. After diagnosing it, use a
  temporary updater-unit override to append `--retry` to ExecStart, start the
  updater once, then remove that override. Keep all resource limits and the
  timer configuration. Do not run an unbounded update from a shell.
- Roll back with `node ~/.local/lib/emc2-web/web-deploy.mjs rollback` after
  stopping the timer. This drains the replacement, checks the previous revision
  and marks the removed release as failed so it cannot immediately redeploy.
- If the updater is interrupted, inspect its unit state and ensure no updater
  remains before removing the empty `~/.local/share/emc2-web/update.lock`
  directory with `rmdir`. A lock is never reclaimed automatically. Run
  `node ~/.local/lib/emc2-web/web-deploy.mjs recover` to restore the pre-switch
  source and verify its revision. A failed recovery retains `pending.json` and
  blocks later updates. Do not kill a live browser to clear a failed drain.
- Retain all release directories. There is no automatic pruning, profile backup,
  database downgrade, credential rotation or release publication.

The open browser's existing Update ready notice handles refreshing once the
host has switched. Finish editors and resolve uncertain writes first. Host
recovery sign-in can be required after restart; paired-browser trust follows the
existing authentication policy.
