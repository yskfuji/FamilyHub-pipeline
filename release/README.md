# Release artifacts

`npm run package` generates:

- `family-hub-static.zip`: deployable contents of `dist/`
- `family-hub-source.tgz`: source, docs, audit records, and screen gallery (files git tracks or would track: `.gitignore` keeps out `node_modules`, builds, databases, uploads, media, `.env` files and test output; `release/` is left out too). Check the list with `bash scripts/package.sh --dry-run`
- `SHA256SUMS`: SHA-256 checksums for both archives

Generated archives are intentionally untracked but are included in the delivered local directory.
