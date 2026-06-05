# wasifs Format Spike

## Scope

This document defines the first spike format for `system-lisp.wasifs` and
`user-filesystem.wasifs`.

The format is intentionally tar-compatible first. A `.wasifs` file can be
listed with `tar tf` and hashed with common checksum tools. Compression,
deduplication, and content-addressed storage are deferred until runtime mount
semantics are proven.

## System Image

`system-lisp.wasifs` is read-only and rooted at `system/` inside the tar
payload. Runtime mount path:

```text
/system
```

The sidecar manifest records:

```text
schema_version
kind
format
emacs_version
source_commit
source_tag
created_utc
root_prefix
mount
contents
content_hash
```

The system image is stable for a pinned Emacs release and should not contain
user state.

## User Image

`user-filesystem.wasifs` is writable after import and rooted at `home/user/`
inside the tar payload. Runtime mount path:

```text
/home/user
```

The initial empty user image contains:

```text
home/user/init.el
home/user/.emacs.d/
home/user/.emacs.d/lisp/
home/user/.emacs.d/elpa/
home/user/projects/
home/user/.local/share/wasmacs/
home/user/.local/share/wasmacs/journal.jsonl
home/user/.local/share/wasmacs/snapshots/
```

The sidecar manifest records:

```text
schema_version
kind
format
created_utc
root_prefix
mount
contents
journal
snapshot
content_hash
```

## Journal

The spike journal is newline-delimited JSON at:

```text
home/user/.local/share/wasmacs/journal.jsonl
```

Each future journal entry should describe one filesystem mutation:

```json
{"schema_version":1,"op":"write","path":"/home/user/init.el","mtime":"2026-06-01T00:00:00Z","sha256":"..."}
```

For Milestone 5, the journal starts empty. Runtime mutation replay is not yet
implemented.

## Snapshots

Snapshots are reserved under:

```text
home/user/.local/share/wasmacs/snapshots/
```

For the spike, a snapshot is another tar-compatible `.wasifs` export plus a
manifest. Later runtime work can decide whether snapshots live inside the user
image or beside it. The current stable rule is that import/export artifacts are
explicit files, not hidden OPFS or IndexedDB implementation details.

## Stable vs Spike

Stable for now:

- `.wasifs` must be explicitly importable/exportable.
- `system-lisp.wasifs` is read-only.
- `user-filesystem.wasifs` is writable after import.
- Tar listing must work without custom runtime code.
- Manifests must include content hashes.

Spike-only:

- Uncompressed tar payloads.
- Sidecar manifests instead of embedded manifests.
- Empty journal semantics.
- Snapshot location and compaction policy.
