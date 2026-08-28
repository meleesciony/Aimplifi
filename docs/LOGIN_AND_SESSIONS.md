# Login and sessions — the standard procedure

How signing in to Aimplifi works, how long you stay signed in, and how to get out.
If you only read one thing: **Aimplifi signs you out after 30 minutes with no
activity, unless you check "Remember me on this device" at sign-in.** That
checkbox stretches the idle window to 30 days on this computer. Closing the lid
or the browser does not, by itself, sign you out — inactivity does.

This document is the source of truth for that behaviour. The numbers live in
`src/lib/engine/auth/session-lifetime.ts` (`SESSION_IDLE_TIMEOUT_SECONDS` and
`SESSION_REMEMBER_TIMEOUT_SECONDS`) and are re-exported from `src/auth.config.ts`.
The sign-in screen and the tests read them from there, so they cannot drift apart.

---

## 1. Signing in

There are three ways in. All of them land you on the dashboard.

**Email and password.** Type your email address and password into the form on the
sign-in page and press the sign-in button. If you have never used Aimplifi before,
the same form creates the account — Aimplifi is invite-only at the moment, so the
email address has to be on the allowlist or the account is not created.

**Remember me on this device.** Optional checkbox on that form, **off by default.**
Leave it unchecked on a shared or public computer. Check it on a computer you
own if you do not want to type the password again every time you open the lid.
Google sign-in and the demo do not have this checkbox; they always use the
30-minute idle window.

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

## 2. Staying signed in

Aimplifi uses a **rolling idle timeout.** Using the app pushes the window out;
doing nothing until the window elapses signs you out.

**Default (Remember me unchecked).** 30 minutes of inactivity. Walking away from
a shared machine, or shutting down overnight, lands you on the sign-in screen
once those 30 minutes have passed. Closing the tab and coming back ten minutes
later does not — the differentiator is idle time, not browser-close.

**Remember me checked.** 30 days of inactivity on **this browser on this
computer.** Closing the lid or the browser does not sign you out. "Sign out" and
"Sign out of all devices" still end the session immediately. Do not check this
on a shared or public computer.

Two things this does *not* do, stated plainly:

- There is **no absolute cap** on a session you keep using. Someone who keeps
  clicking all day stays signed in all day. The timeout measures inactivity, not
  total time.
- Remember-me is **opt-in per sign-in**, not a saved preference on the account.
  The next sign-in starts unchecked again.

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
on the next request, on every device at once. It does not depend on the idle
timeout expiring, and there is nothing to wait for.

**Delete everything.** Settings also offers deletion of your data, which signs you
out as part of the same action. See `docs/PRIVACY.md` for exactly what is removed.

---

## 4. On a shared or public computer

1. Leave "Remember me on this device" unchecked. Prefer a private/incognito
   window — it discards cookies when you close it.
2. Press "Sign out" when you finish. Do not rely on the 30-minute timeout, and do
   not rely on closing the tab.
3. If you walked away without signing out, sign in from your own device and use
   "Sign out of all devices" (step 3 above). That reaches the machine you left.

---

## 5. For whoever maintains this

The numbers live in `src/lib/engine/auth/session-lifetime.ts`. Auth.js
`session.maxAge` is the **remember ceiling** (30 days), because the library
re-signs JWT `exp` and cookie `Expires` from that single number on every session
read and cannot vary it per sign-in. The default 30-minute window is enforced by
`applySessionLifetime` in the edge jwt callback: a token without `remember: true`
is dropped once idle past 30 minutes. Returning `null` from that callback is
what Auth.js treats as logout — `@auth/core/lib/actions/session.js` then calls
`sessionStore.clean()` and does **not** re-issue the cookie. Demo and Google
sign-ins never stamp `remember: true`.

```ts
session: { strategy: 'jwt', maxAge: SESSION_REMEMBER_TIMEOUT_SECONDS },
// jwt callback: applySessionLifetime(...) — null drops a default session at 30 min idle
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
after a `next build`. It performs an actual demo sign-in against a locally started
server and prints the `Set-Cookie` header. A **live** (not-yet-idle) demo
session's cookie `Expires` follows the 30-day Auth.js ceiling; after 30 minutes
idle the jwt callback returns null and Auth.js **clears** that cookie. Recorded
run of the pre-#527 30-minute-cookie era, 2026-07-27: signed in at `16:55:21 UTC`,
cookie came back `Expires=Mon, 27 Jul 2026 17:25:21 GMT` — 30 minutes to the
second, `HttpOnly`, `SameSite=Lax`.

Changing the numbers: edit `SESSION_IDLE_TIMEOUT_SECONDS` or
`SESSION_REMEMBER_TIMEOUT_SECONDS` in `session-lifetime.ts` only. The sign-in copy
derives from them. `tests/unit/session-timeout.test.ts` bounds the default window
to 5–30 minutes and the remember ceiling to 30 days — raising the default past 30
minutes is meant to require deleting an assertion that explains why it exists.

Related: `docs/PRIVACY.md` (§ Security measures, § multi-device session
invalidation), `src/server/session-guard.ts`, `src/lib/engine/auth/session.ts`.
