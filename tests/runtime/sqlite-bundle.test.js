// The published Emacs has SQLite (linked in by src/build/build-sqlite.sh):
// Emacs's own sqlite-* functions work on database files in its filesystem.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { batchEval, docsArtifactDir, repoRoot } from "../../tools/scripts/lib/pdump-node-harness.mjs";

const skip = !existsSync(`${docsArtifactDir}/temacs.wasm`) && "docs/artifacts has no Emacs build";

test("Pages bundle: Emacs opens, writes and queries an SQLite database", { skip }, async () => {
  const result = await batchEval(`(let ((db (sqlite-open "/tmp/bundle-test.db")))
    (sqlite-execute db "CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL, done INTEGER DEFAULT 0)")
    (sqlite-execute db "INSERT INTO notes (text) VALUES (?)" (list "first"))
    (sqlite-execute db "INSERT INTO notes (text, done) VALUES (?, ?)" (list "second; DROP TABLE notes" 1))
    (sqlite-transaction db)
    (dotimes (i 500) (sqlite-execute db "INSERT INTO notes (text) VALUES (?)" (list (format "row %d" i))))
    (sqlite-commit db)
    (sqlite-close db)
    ;; A second connection finds what the first one wrote to the file.
    (let ((again (sqlite-open "/tmp/bundle-test.db")))
      (prog1 (list (sqlite-available-p)
                   (string-match-p "\\\\\`3\\\\." (sqlite-version))
                   (sqlite-select again "SELECT id, text, done FROM notes WHERE id <= 2")
                   (sqlite-select again "SELECT count(*), sum(done) FROM notes")
                   (condition-case nil (sqlite-execute again "INSERT INTO nothing VALUES (1)") (error 'refused)))
        (sqlite-close again))))`, { artifactDir: docsArtifactDir });
  assert.equal(result.ok, true, `Emacs signalled ${result.value}`);
  assert.equal(result.value, '(t 0 ((1 "first" 0) (2 "second; DROP TABLE notes" 1)) ((502 1)) refused)');
});

test("SQLite is taken from sqlite.org by a pinned hash, not kept in the repository", () => {
  const script = readFileSync(`${repoRoot}src/build/build-sqlite.sh`, "utf8");
  assert.match(script, /SQLITE_SHA3=[0-9a-f]{64}/);
  assert.match(script, /https:\/\/www\.sqlite\.org\//);
  assert.match(script, /public domain/);
  assert.equal(existsSync(`${repoRoot}src/build/sqlite3.c`), false);
});
