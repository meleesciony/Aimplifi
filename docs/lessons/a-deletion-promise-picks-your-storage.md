# A written deletion promise is an architecture constraint, and it outranks the vendor in the task row

**One line:** O.13h's task row specified "Vercel Blob, private"; the retention policy's §3
promise — one cascading delete removes everything, nothing is retained afterwards — made object
storage the wrong answer, because a bucket honours that promise only through a compensating
delete on **five** separate paths and one miss leaves a photograph of somebody's receipt outside
the guarantee permanently.

## What happened

The row read: *"Receipt / file attachments. No column, no upload, no storage — needs a real
storage decision (Vercel Blob, private) plus retention and deletion paths."* The obvious reading
is that the vendor is settled and "retention and deletion paths" is follow-on work.

Read the other way round, the deletion paths **decide** the vendor. `DATA_RETENTION_AND_DISPOSAL.md`
§3 already promised, in writing, to a reader: *"A single cascading delete of the user record removes
every associated row… There is no soft-delete or archive path; nothing about the user is retained
after deletion."* §6 separately denies any third-party data flow beyond Plaid/SimpleFIN and the
optional AI call.

Object storage falsifies both. The bucket is not reached by a Postgres cascade, so the promise
would have needed a compensating delete on every one of: the reader removing one file, the
transaction being deleted, the account being deleted, the user being deleted, and an upload whose
row insert failed *after* the object landed. That is the fence-by-call-site anti-pattern
(`fence-by-construction-not-per-call-site.md`) applied to medical paperwork, and its failure is
silent, permanent, and discovered by nobody.

In the database the FK cascade **is** the deletion path. Nothing to remember, nothing to miss.

## The rules

1. **A guarantee already in writing is a design input, not documentation to update afterwards.**
   Before choosing where new data lives, grep the policy docs for what the app has already
   promised about that data class. The promise constrains the architecture; discovering it after
   the build means either breaking it or rewriting it, and rewriting a privacy promise to match
   what you happened to build is the worse of the two.
2. **Count the compensating deletes before accepting a second store.** If the answer is more than
   zero, that number is the number of places a future editor can leave someone's data behind. Two
   stores means every lifecycle event needs both halves; one store means the database does it.
3. **A vendor in a task row is a suggestion by whoever wrote the row, not a requirement.** It was
   written before the build, by someone who had not yet re-read the policy. Say so and re-decide,
   in the record, with the argument — do not silently comply and do not silently deviate.
4. **Assert the guarantee at the level the promise is written at.** The promise is about deleting a
   USER, so the test deletes a user — then counts the bytes **globally**, not through the ownership
   join, because a deleted parent makes a scoped count blind to exactly the orphan you are hunting.
   A scoped count here would have passed against a table full of abandoned files.
5. **Check whether the suggested path could even ship.** There was no `BLOB_READ_WRITE_TOKEN` on
   the project (`vercel env ls production`), so the blob build would have typechecked, deployed,
   and done nothing in production — this repo's recurring failure (#348's dead banner, L.7's
   `'use server'` export). One read-only command settles it before any code is written.

## The corollary that is not about storage

The same slice re-proved two older rules the hard way, both inside one file:

- **Never put the characters you are rejecting into the source that rejects them.** The filename
  guard's control-character class was first written with literal control bytes (`grep` reported
  the source as binary), and the *fix*, routed through a shell heredoc, produced them a second
  time. The version that survives is a code-point comparison: no literal control byte, and no
  backslash escape for a rewrite to mangle. (Extends
  `a-disclosure-written-for-a-page-is-false-in-an-email.md`.)
- **A stored value that will be echoed in a header is a security decision, not a field.** The
  attachment's content type is sniffed from magic bytes because it becomes the `Content-Type` of a
  response this app serves from its own origin, beside a signed-in banking session — so the
  browser's declared type and the filename extension, both attacker-controlled, decide nothing.
  Re-asserted on the read path, because a guard that only runs at creation is advisory.
