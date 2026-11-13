# Release

## Summary of changes

- New `src/slugify.js` exporting `slugify(text)`.
- Tests in `test/slugify.test.js` covering AC-1..AC-3.

## Acceptance criteria status

All criteria have passing evidence; see traceability.md.

## Migration

None.

## Deployment steps

No deployment process found in the repository. The change ships with the next package release.

## Rollback steps

Revert the commit that adds `src/slugify.js` and `test/slugify.test.js`; nothing else depends on it.

## Known issues and unverified claims

- Non-ASCII letters are dropped, not transliterated (review O1).
