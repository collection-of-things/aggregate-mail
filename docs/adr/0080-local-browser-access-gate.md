# ADR 0080: Password gate for local browser access

Status: Owner-requested implementation; independent review and verification required.
Date: 2026-10-25

The optional browser target requires a local password before serving application
assets or mail APIs. Desktop startup keeps its existing token authentication.
MCP retains its independent bearer permissions. Google consent initiation needs
a browser session; the callback retains its existing single-use state and Lax
state-cookie validation, because the Strict browser cookie is absent on return.

Hash the supplied password with scrypt. Keep one random browser session in memory
and an HttpOnly, SameSite=Strict cookie. New login, lock and restart invalidate
previous sessions. Require exact loopback hosts and configured origin. Login and
lock require an Origin header. Admit at most five password attempts per minute,
including successful and concurrent attempts. Hashing is serial and bounded by
that admission limit. Sessions expire after 30 minutes without a request or
eight hours total. Background requests count as activity.

Browser startup validates configuration before importing storage. It requires
an externally supplied 32-byte encryption key and an explicit data directory
outside source and static roots, resolving symlinks through existing ancestors.
Refuse legacy and desktop key markers. Do not change or migrate desktop data,
create a new key-file fallback or weaken encrypted storage. The operator remains
responsible for secure external key provisioning and preserving the original key.

The gate protects the local HTTP boundary. It cannot protect a compromised OS
account or a hostile local process that can inspect environment variables or
receive localhost cookies on another port. It provides no remote hosting,
multi-user isolation or password recovery. Keep mail-content restrictions,
origin and CSRF checks, and explicit remote-image consent.

Synthetic HTTP and subprocess tests cover admission, denial, expiry, rotation,
locking, concurrent attempts and rejection before storage access. Native,
real-account, installed and interactive browser proof remain separate.

Browser rendering also checks access before mounting private content and every
10 seconds afterward. A revoked session or failed access check removes mounted
mail and drafts. Hidden tabs conceal content and recheck access on return.
The access page broadcasts explicit locking to other tabs on the same origin.
Checks of session status do not renew request-idle expiry. Browser-session loss
can discard unsaved edits; it never sends mail or retries an uncertain send.
