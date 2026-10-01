# Security notes

## Local access and secrets

This is a single-user local application. `npm run dev` and `npm start` listen on `127.0.0.1`. API routes accept loopback hostnames by default, reject cross-origin writes, and check browser fetch metadata. This also blocks requests using a hostile hostname that resolves to loopback.

Secrets belong in ignored `.env.local` files or server environment variables. No `.env` file is tracked. Chat history and the preserved legacy chat/fleet storage are browser-local and are not encrypted; anyone with access to that browser profile can read them. Submitted questions are processed by the configured OpenAI service when its key is enabled.

## Request and output protections

- Chat JSON is limited to 64 KiB, questions to 8,000 characters, and history to 20 validated messages. Legacy selected-ship input is not applied to reference questions.
- The shared in-process budget allows 30 chat requests/minute, 300/hour, and 4 concurrent chat requests across both chat endpoints. Cache reset is limited to 2/minute. Rejections return HTTP 429 with `Retry-After`.
- JSON uploads have a read deadline. Upstream requests have timeouts and bounded retries; disconnected streams stop sending data. An upstream operation already in progress may run until its timeout.
- CSV and copied table cells neutralize spreadsheet formula prefixes; CSV headings and values are escaped. Chat text is rendered as React text rather than raw HTML. Response image URLs must use HTTPS and omit embedded credentials.
- Responses include anti-framing, MIME-sniffing, referrer, permissions, and limited content-security-policy headers. The CSP does not claim full script-source/XSS containment; it preserves Next.js hydration and development tooling.

## Remote deployment

Do not expose this app directly to the internet with a paid API key. Public hosting requires an authenticated HTTPS gateway and a shared rate/budget store across replicas. The built-in limiter is per process, resets on restart, and is not a user authentication system.

After configuring that gateway, set `APP_ORIGIN` to the exact trusted origin, such as `https://trade.example.com`, without a trailing slash. Configure the proxy to preserve that Host header. Avoid permissive origin or host wildcards.

## Dependency review — October 1, 2026

Next.js was upgraded to 16.3.8, React to 19.3.0, and application dependencies to current releases. Obsolete UUID packages were replaced by `crypto.randomUUID()`. The shadcn CLI is a build/development dependency. Node 24.21.0 LTS is pinned in `.nvmrc`; Node 25 is end-of-life. A verified official Node 24 archive was installed in ignored `.runtime/` for this machine's checks and running server; other machines should use `.nvmrc`.

The React hooks plugin supports ESLint 10, but the installed React, accessibility and import plugins still require ESLint 9. The ESLint 10 compatibility check failed, so ESLint stays on the latest supported 9.39.5 release. TypeScript ESLint still requires TypeScript below 6.1, so TypeScript 7 cannot yet be used with this lint setup. Node types remain aligned with the Node 24 LTS runtime.

The [updated Next.js security notice](https://nextjs.org/blog/upcoming-nextjs-security-release-september-2026) moved the September security release to 16.3.8 and says two vulnerabilities (one critical, one high) remain pending upstream coordination for a later release. This app now runs 16.3.8, and the package audit reports zero published dependency vulnerabilities. A clean audit does not establish that every possible security issue is fixed; the pending upstream items remain unresolved by this update.
