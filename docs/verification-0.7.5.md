# Version 0.7.5 verification

This release contains the directory source corrections documented in directory-compliance.md. The plugin ID remains citizen; room and checkpoint protocol remain 14. The repository URL and historical release archives remain stable.

The final 0.7.5 source passed production build, TypeScript checking, and all 238 automated tests with zero failures. Tracked-source and production-bundle scans found no known private checkout paths or credential markers. Manifest, package metadata, lockfile, and compatibility map agree on version 0.7.5.

The maintainer expressly reconfirmed OB Citizen as the public name after reviewing the diagnostic results. The source-only directory preview completed with zero errors when the diagnostic display name Citizen was used on the same repository; the OB Citizen naming result remains a separate acceptance condition. This release preserves OB Citizen and does not claim a naming exception.

The release workflow reruns the build and tests on the final tag. Publication requires downloaded asset, manifest, ZIP membership, SHA-256, and private-marker verification. The live directory release scan is the acceptance check; a successful preview is not a passed published release. Native gameplay and cross-computer connectivity are not revalidated by these compliance changes.

## Published release verification

- Source commit: b4449dfef1765348a9ca86f7d757ac9e64633de1; tag: 0.7.5.
- GitHub Actions run 38948295233: completed successfully, including the production build, tests, packaging, and provenance attestations.
- Downloaded all five draft assets before publication. Their sizes and SHA-256 digests match GitHub's asset metadata; SHA256SUMS.txt verifies the three plugin files and ZIP.
- The ZIP contains exactly main.js, manifest.json, and styles.css, each byte-for-byte identical to its separate release asset.
- The downloaded manifest uses OB Citizen, citizen, version 0.7.5, and the maintainer's personal GitHub profile as authorUrl. Known private-path and credential-marker scans passed.
- Published the release as latest at https://github.com/j117mw3/obsidian-citizen/releases/tag/0.7.5.
