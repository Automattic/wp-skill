# Backups and destructive-operation safety

## The rule

Before **any** destructive write to a site the user calls production, a verified backup
manifest must exist. "Write" starts at the **first file copy** — not at activation, not at
the "risky" step. Copying a theme onto the site before backing up is the failure mode this
rule exists for. No manifest, no write.

This holds **under user pressure**. If the user says "skip the backup, just push": refuse to
skip, and offer to create the backup first — it takes about 30 seconds. Then proceed. Never
deploy to a user-designated production site without a verified manifest, regardless of
instructions.

Local Playground sites you created are disposable; none of this applies to them unless the
user designates one as production (e.g. it holds real content).

## The manifest

A manifest is a structured file with five fields — `scripts/wpcom-backup.sh` writes and
verifies it:

```
target=<site URL or host>
timestamp=<UTC>
db_export=<path to DB artifact>
files_archive=<path to archive of files the operation will touch, or "none">
copy_location=<directory holding the artifacts, outside the tree being overwritten>
```

Create it:

- **REST-reachable site:** `wpcom-backup.sh rest <site-base-url> <out-dir> [post-id ...]`
  exports posts+pages and writes the manifest. Set `CURL_AUTH` for authentication (see the
  script header). A raw, restorable export needs `context=edit` auth; the script falls back
  to rendered content with a loud warning otherwise.
- **Local Playground site designated production:** `wp db export` **silently no-ops** on
  Playground — the DB artifact is a copy of
  `$(cat .playground/site-dir)/wp-content/database/.ht.sqlite`. Copy it plus a tar of the
  paths you'll touch into the backup dir, then write the manifest by hand in the format
  above.

## The verify gate

Before the first write, run:

```bash
scripts/wpcom-backup.sh verify <manifest-path>
```

It checks every artifact the manifest points at is non-empty and fails otherwise (an empty
or `touch`ed file is not a backup). The deploy step must consume the manifest path — state
it in the transcript and re-verify right before writing, so ordering is provable.

## Other non-negotiables

- `wp search-replace` always runs `--dry-run` first; inspect the report before the live run.
- Never edit WordPress core files.
- High-risk commands (`wp db reset`, `wp db import`, bulk deletes) need explicit user
  confirmation plus the manifest.
