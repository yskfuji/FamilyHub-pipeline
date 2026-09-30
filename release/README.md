# Release artifacts

`npm run package` generates:

- `family-hub-static.zip`: deployable contents of `dist/`
- `family-hub-source.tgz`: source, docs, audit records, and screen gallery (excluding `node_modules`, `.git`, reports, and `release`)
- `SHA256SUMS`: SHA-256 checksums for both archives

Generated archives are intentionally untracked but are included in the delivered local directory.
