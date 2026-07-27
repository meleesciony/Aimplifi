# Login and sessions — the standard procedure

How signing in to Aimplifi works, how long you stay signed in, and how to get out.
If you only read one thing: **Aimplifi signs you out after 30 minutes with no
activity.** Closing the lid, closing the browser, or shutting the computer down and
coming back later all land you on the sign-in screen.

This document is the source of truth for that behaviour. The number itself lives in
exactly one place in the code — `SESSION_IDLE_TIMEOUT_SECONDS` in
`src/auth.config.ts` — and both the sign-in screen and the tests read it from there,
so they cannot drift apart.

---

## 1. Signing in

There are three ways in. All of them land you on the dashboard.

**Email and password.** Type your email address and password into the form on the
sign-in page and press the sign-in button. If you have never used Aimplifi before,
the same form creates the account — Aimplifi is invite-only at the moment, so the
email address has to be on the allowlist or the account is not created.

**Continue with Google.** This button only appears if the site has been configured
with Google credentials. Pressing it hands you to Google's own sign-in screen; when
Google confirms who you are, it sends you back and you are signed in. Aimplifi never
sees your Google password. The same invite-only allowlist applies.

**Explore the demo.** The "Explore the demo" button signs you into a shared,
fictional account full of made-up accounts and transactions. It needs no email
address and no password. Nothing in the demo is real and nothing you type there is
private — treat it as a showroom, not a place to put your own numbers.

### If you forget your password

Use the "Forgot password" link on the sign-in page. It emails you a link that lets
you set a new one. The link is single-use and expires. Setting a new password does
not currently sign out your other devices on its own — if you are resetting because
you think someone else has your password, do step 3 below as well.

---

## 2. Staying signed in — the 30-minute rule

Aimplifi uses a **rolling idle timeout of 30 minutes.**

- **While you are using the app, you stay signed in.** Every page you load pushes
  the 30-minute window out to a fresh 30 minutes from that moment. You will not be
  thrown out in the middle of reviewing transactions, however long that takes.
- **Do nothing for 30 minutes and the session is over.** The next click lands on the
  sign-in page and you type your password again.
- **Shutting the computer down does not preserve anything.** The sign-in is stored
  in a browser cookie that expires 30 minutes after your last page load. Shut down
  overnight, come back in the morning, and it is gone. This is the behaviour the
  30-minute window exists to produce.

Two things this does *not* do, stated plainly so nobody assumes otherwise:

- There is **no absolute cap**. Someone who keeps clicking all day stays signed in
  all day. The timeout measures inactivity, not total time.
- There is **no "remember this device" option**. Every device gets the same
  30 minutes. This is deliberate for a first release of a money app — an opt-in
  long-lived session is a feature that has to be designed, not a checkbox.

---

## 3. Signing out

**Sign out of this browser.** Press "Sign out" in the top bar of any page inside the
app. You are returned to the sign-in page immediately.

**Sign out of every device.** Go to Settings and press "Sign out of all devices."
Use this one if you have signed in on a computer you no longer control — a work
laptop, a hotel machine, a phone you have sold. It invalidates every sign-in
everywhere, including the browser you are pressing the button in, so you will be
asked to sign in again right away. That is the confirmation it worked.

Under the hood this bumps a counter on your user record (`sessionEpoch`) that is
stamped into every sign-in token. Tokens carrying the old number stop being accepted
on the next request, on every device at once. It does not depend on the 30-minute
timeout expiring, and there is nothing to wait for.

**Delete everything.** Settings also offers deletion of your data, which signs you
out as part of the same action. See `docs/PRIVACY.md` for exactly what is removed.

---

## 4. On a shared or public computer

1. Prefer a private/incognito window — it discards cookies when you close it.
2. Press "Sign out" when you finish. Do not rely on the 30-minute timeout, and do
   not rely on closing the tab.
3. If you walked away without signing out, sign in from your own device and use
   "Sign out of all devices" (step 3 above). That reaches the machine you left.

---

## 5. For whoever maintains this

The whole policy is four lines of configuration in `src/auth.config.ts`:

```ts
export const SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60;
...
session: { strategy: 'jwt', maxAge: SESSION_IDLE_TIMEOUT_SECONDS },
```

Why `maxAge` behaves as an *idle* timeout rather than a hard expiry, verified in the
installed dependency source rather than assumed:

- `@auth/core/lib/actions/session.js`, the `jwt` branch, re-signs the token and
  re-sets the cookie with `expires = now + maxAge` on **every** session read. It is
  unconditional — `session.updateAge` is only consulted in the *database*-strategy
  branch, so setting `updateAge` alongside a `jwt` strategy does nothing.
- `next-auth/lib/index.js` (`handleAuth`) copies the `Set-Cookie` headers from that
  session read onto the response the middleware returns — the comment in the source
  reads "Preserve cookies from the session response".
- `src/middleware.ts` runs on every app route, so every page load performs that
  read and therefore rolls the window forward.

To see the real cookie rather than trust the config, run `bash scripts/probe-session-cookie.sh`
after a `next build`. It performs an actual demo sign-in against a locally started server and prints
the `Set-Cookie` header. Recorded run, 2026-07-27: signed in at `16:55:21 UTC`, cookie came back
`Expires=Mon, 27 Jul 2026 17:25:21 GMT` — 30 minutes to the second, `HttpOnly`, `SameSite=Lax`.

Changing the number: edit `SESSION_IDLE_TIMEOUT_SECONDS` only. The sign-in copy
derives from it, and `tests/unit/session-timeout.test.ts` bounds it to between 5 and
30 minutes — raising it past 30 minutes is meant to require deleting an assertion
that explains why it exists.

Related: `docs/PRIVACY.md` (§ Security measures, § multi-device session
invalidation), `src/server/session-guard.ts`, `src/lib/engine/auth/session.ts`.
