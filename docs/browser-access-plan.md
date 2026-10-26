# Protected localhost browser access

Add a password gate to the optional browser target before it can expose mail.
Track delivery in issue #83. Preserve desktop authentication, encrypted records,
MCP grants and provider operations.

1. Add browser authentication middleware with exact loopback host and origin
   checks, scrypt password comparison, an in-memory HttpOnly SameSite=Strict
   session, login attempt limits and an explicit lock action. One active session
   expires after 30 minutes without a request or eight hours total. Login rotates the session.
   Prove denial, login, expiry, rotation and lock over synthetic HTTP.
2. Validate browser configuration before storage imports. Require a supplied
   encryption key, a password and an isolated directory outside source and
   static roots. Refuse desktop key markers. Desktop skips browser configuration.
   Prove rejected startup creates no store.
3. Mount before API/static handlers. Keep MCP bearer authorization separate.
   Only the Google callback may return without a session; its existing single-use
   state and Lax cookie remain required. Consent initiation needs a session.
4. Document setup and limits in README, CONTRIBUTING and KB; update CHANGELOG.
   Reserve attempts before serial password hashing. Proxy access endpoints for development and deny private files through Vite.
5. Run focused tests, required serial suite and strict build using Fleet
   containment. Independently review the diff before task-owned delivery.

Passwords and session credentials never go into logs, URLs or browser storage.
The operator supplies the password and encryption key. No new key-file fallback,
profile migration, provider activity, runtime packaging, remote hosting,
password recovery or multi-user support. A compromised OS account remains
outside this gate's protection. No live accounts or browser automation.

Rollback removes middleware and startup validation without a record migration.
Do not claim browser release readiness before gate and startup checks pass.

Browser rendering also checks access before mounting private content and every
10 seconds afterward. A revoked session or failed access check removes mounted
mail and drafts. Hidden tabs conceal content and recheck access on return.
The access page broadcasts explicit locking to other tabs on the same origin.
Checks of session status do not renew request-idle expiry. Browser-session loss
can discard unsaved edits; it never sends mail or retries an uncertain send.
