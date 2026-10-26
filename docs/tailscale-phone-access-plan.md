# Private phone access from Settings

Extend the protected browser target so Settings can configure private HTTPS
Tailscale Serve on the machine running Emc². Keep the browser password, loopback
listener, encrypted profile, origin/CSRF checks, desktop behavior and independent
MCP grants. No public Funnel, Tailscale login automation or profile migration.

1. Extend the browser gate with one exact verified tailnet HTTPS origin beside
   its existing loopback origin. Derive the origin from local Tailscale status,
   never request input or forwarded identity headers. HTTPS cookies use Secure
   and a __Host- name. Bind sessions to their login origin. Preserve the
   existing single-active-session behavior. Keep local host management working.
2. Add a bounded server Tailscale adapter and encrypted owned-route record.
   Authenticated local Settings requests may enable or disable one unused HTTPS
   port. Require explicit confirmation and normal CSRF. Use execFile without a
   shell, bounded output/time, and a minimal environment excluding mail secrets.
   Read status/config, select an unused port, preserve existing routes, verify
   the exact proxy target and absence of Funnel, and probe TLS plus gate identity
   before reporting success. Delete only a still-matching owned route; never
   reset Serve or change authentication, ACLs, firewall or other routes.
3. Restore a saved route only after live identity/private-target checks. Missing
   or changed routes revoke remote-origin admission and leave localhost usable.
   Do not trust forwarded headers or Tailscale identity headers as authentication.
   Keep MCP loopback-only. Make OAuth callback origin match the trusted origin
   that started consent, stored in existing single-use consent state.
4. Add Settings > Phone access with host capability/status, Enable, Refresh,
   Disable and Copy URL. Require host-local management, show unsupported desktop
   and missing/signed-out/permission/error states, and hide private addresses in
   privacy mode. Phone browsers keep password login and may read status.
   Route admission expires after 60 seconds and renews every 30 seconds.
   Expiry destroys the retained phone session even when verification recovers.
   Serialize startup, renewal and Settings mutations. Persist pending ownership
   before mutation and ready only after verification. Keep pending on unsafe
   cleanup and show an error.
5. Test command allowlists, missing Tailscale, signed-out hosts, route collision,
   preservation, Funnel refusal, TLS/probe failure, restore/disable ownership,
   host/Origin rejection, Secure cookies, OAuth origins and Settings states with
   synthetic data and injected CLI/probes. Run bounded focused checks and build.
   Reuse unchanged proof; the earlier canonical full-suite hold remains.
6. Update docs/ADR/changelog and the draft pull request. Commission a private route only
   after candidate checks, with securely supplied runtime credentials. Report
   phone-device access separately from verified HTTPS host access.

Rollback removes only the matching owned route and clears its encrypted record
and trusted origin. Failures must not delete or overwrite unrelated routes.
All settings and runtime proof must refer to the host, not any fixed machine.
