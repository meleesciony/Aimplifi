# File tools decode backslash-u escapes: write non-ASCII controls as hex or as Unicode-property classes

Writing source via Write/Edit, a backslash-u escape in a string literal did
not survive as source text. A regex class requested as U+0000..U+001F plus DEL
arrived on disk with the characters **decoded**: real NUL/control bytes (grep
said "Binary file matches" and the file broke `tsc`/eslint), and U+2028 in a
character class arrived as a raw line-separator byte — a syntax error in
legacy parsers, an invisible non-ASCII byte in any case. The same happened in
a markdown file: the visible text turned into invisible bytes.

**Why.** The path between the model and the file treats an escape as a request
to WRITE the character, so the escape does not survive as text. A hex escape it
does not decode does survive. (Twin of `windows-codegen-via-shell`: that lesson
is about heredocs; this one is about the file tools themselves — "byte-exact"
is true of the tool receiving the file, not of the text passing through the
model.)

**How to apply.** For non-ASCII control/separator characters in source code:
- below 0x100, use the two-digit hex escape form ONLY (it survives);
- above that, use Unicode property escapes with the u flag — pure ASCII
  source such as a class combining p{Cc}, p{Zl} and p{Zp};
- never write a backslash-u sequence in a file you want to be ASCII-clean;
- after any such edit, probe the bytes (a node one-liner reading the file and
  filtering for control code points) before running the compiler.

A TEST may intentionally carry literal U+2028/29 input bytes (ES2019 strings
permit them) — but the SOURCE of the invariant stays ASCII. First hit
2026-08-23, DECISIONS #504 (an attempted control-char regex produced a binary
file, then a raw line separator).
