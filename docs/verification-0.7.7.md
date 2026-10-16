# Citizen 0.7.7 verification

## Automated checks

- `npm run lint` passes, including the CSS review checks.
- `npm run build` passes TypeScript checking and creates the production plugin bundle.
- `npm test` passes all 241 tests.
- Flight regressions cover left-click firing, F docking, continuous hold progress, and the 14-unit client range; authoritative docking regressions cover the 14-unit boundary.
- Terrain regressions cover rendered-surface sampling across cube faces and terrain levels of detail, boot contact during animated patrol movement, and nameplate placement.

## Release package

The release workflow checks that the tag matches `manifest.json`, then packages exactly `main.js`, `manifest.json`, and `styles.css` into `citizen-0.7.7.zip` and records SHA-256 checksums for those files and the ZIP. The workflow attaches those assets and provenance attestations to the release draft.

## Runtime boundary

These checks do not establish native Obsidian rendering or live gameplay acceptance. No native visual inspection or two-computer session was performed for this release.
