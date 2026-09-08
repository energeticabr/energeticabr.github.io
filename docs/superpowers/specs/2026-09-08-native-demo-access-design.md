# Native demonstration access

The authorized App Review demonstration uses an explicitly selected login with username and password. It shares the native chat presentation and controller, but has a separate session, store, recovery namespace and `/api/demo` client. The corporate Microsoft domain policy remains unchanged.

The session endpoint is `POST https://163-176-171-217.sslip.io/api/demo/session`; its response contains `accessToken`, `account.homeAccountId` starting with `demo:`, username, name and ISO expiry. Tokens are held only in memory. Invalid, expired or failed sessions never fall back to Microsoft authentication. Sign out clears local demo state, revokes the sandbox token and returns to the normal login without signing out the Microsoft account.

The session switch stops the previous controller before rendering the credential form. A separate view and store prevent corporate messages, drafts and selected files crossing into the demonstration. Demonstration native ports expose explicit camera/document selection and export; they never read or remove ShareInbox items. Recovery uses a separate session-local memory namespace; no production storage is read. Requests and authenticated media must stay under `/api/demo`, with redirects rejected.

The login offers optional “Acesso de demonstração”. Authenticated demo screens permanently show “Demonstração — dados fictícios”. Privacy and support links are available on login. Back from the demo form and demo sign out return to corporate login without automatic corporate initialization.

Verification exercises the real DOM, controller, store, session and client with network/native boundaries replaced. It covers credential error/success, stale authentication, cancellation, request/media confinement, expiry and logout, retained Microsoft session, no imported corporate files and independent recovery.

Release gate: `APP_CONFIG.demoAccessEnabled` remains `false`. The native login does not expose the demo button in a distributed build until the isolated backend has passed remote acceptance and its review credentials are configured. Tests enable the flag explicitly. This is not a hidden reviewer-only switch; once accepted the same visible option will be included for all users in the submitted binary.
