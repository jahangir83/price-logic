# App Bridge session token authentication

Status: Complete (unverified against a real store)
Completed: 2026-08-15
Depends on: install & boot flow (`tasks/install-boot-flow.md`)

The embedded app could not have authenticated a single API call. Every request
went out with `credentials: 'include'` and nothing else, and inside Shopify's
iframe that cookie is a third-party cookie — partitioned or blocked outright by
every current browser. The app would have worked in development, where the
frames are same-origin, and 401'd for every real merchant.

## What was built

- [x] **`ShopifySessionTokenService`** — verifies the JWT App Bridge issues:
  HS256 against the client secret, `exp`/`nbf`, `aud` against our API key,
  `dest` host against `iss` host, and `dest` as a real myshopify domain.

- [x] **`SessionAuthGuard` accepts both credentials** — `Authorization: Bearer`
  first, session cookie second. No controller changed.

- [x] **The frontend sends a token per request** — `getSessionToken()` asks App
  Bridge; `apiFetch` attaches it and retries once on a 401.

- [x] **`APP_NOT_INSTALLED`** — a distinct code for a genuine token naming a
  shop with no install, which sends the merchant back through OAuth instead of
  showing them a dead end.

## Decisions taken

**The header is checked before the cookie.** A cookie left over from a previous
install must never outrank a token Shopify minted seconds ago — there is an e2e
test where the stale cookie would have returned 200 and the token makes the
request fail, which is the only way to prove the fallback did not fire.

**A rejected token is an error, never a fallback to the cookie.** Falling back
would turn a forged token into a successful request whenever a cookie happened
to be present.

**`aud` is checked against our API key.** The check that is easiest to omit and
most expensive to omit: any app on the platform can obtain a session token for a
shop it is installed on, and without `aud` that token would authenticate here.

**`algorithms: ['HS256']` is pinned.** Without it, `alg: none` is a valid token.

**A separate secret from our own session cookie.** The same `JwtService` signs
both, so the Shopify secret is passed per call. Sharing one would mean a token
we minted could be presented as one Shopify minted, and the reverse.

**The token is fetched per request and never stored.** It lives about a minute
and App Bridge already keeps a fresh one; a cache here would only be a second,
worse cache that can serve an expired token.

**One 401 retry.** The gap between App Bridge issuing a token and the backend
verifying it is about a minute wide, and a request landing the wrong side of an
expiry should not reach the merchant as a failure. `APP_NOT_INSTALLED` is exempt
— a second token would be just as valid and just as unusable.

**`apiFetch` performs the reinstall redirect itself.** A navigation from inside
a fetch wrapper is a surprising side effect and still the right one: there is
exactly one recovery, every caller would otherwise duplicate it, and an error
toast reading "not installed" leaves the merchant nowhere to go.

**The cookie path stays.** It is what authenticates the post-install landing and
a tab opened outside the admin, where there is no App Bridge to ask.

**The shop is loaded once per request.** `SessionAuthGuard` hands the row it
already resolved to `ShopGuard`, which confirms the id matches before using it.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (127 files) | 0 errors, 0 warnings |
| backend: unit tests | **251 passed**, 16 suites (22 new) |
| backend: e2e tests | **230 passed**, 13 suites (11 new) |
| frontend: `tsc -b` / eslint / `vite build` | pass · 0 errors · pass |

Proven against tokens signed exactly the way Shopify signs one: a well-formed
token authenticates a guarded endpoint and scopes it to the shop `dest` names;
a `shopId` in the query does not surface another merchant's campaign, while the
same row is visible to the shop that owns it; a wrong secret, another app's
`aud`, an expired token, a not-yet-valid token, a mismatched `iss`/`dest`, a
non-myshopify `dest`, a lookalike domain, an `alg: none` token and a non-JWT are
all refused; a shop with no install gets `APP_NOT_INSTALLED`; the cookie still
works alone; and the token wins when both are present.

Fixed on the way: `apiFetch` set `Content-Type: application/json`
unconditionally, which would have broken the first multipart upload by
overwriting the boundary.

## ⚠ Not verified against Shopify

No token has ever been issued by a real App Bridge. The claim set is taken from
Shopify's session token documentation; if a real token differs, `dest`/`aud`
handling is where it would show.

## Possible follow-up

**Token exchange.** Now that session tokens work, the install could exchange one
for an access token (`urn:ietf:params:oauth:token-type:access-token`) instead of
running the OAuth redirect. It removes the top-frame break-out entirely. Not
done here: the redirect flow is built, tested and works, and swapping the
install path is worth doing against a real store rather than blind.
