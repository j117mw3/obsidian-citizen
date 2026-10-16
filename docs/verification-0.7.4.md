# OB Citizen 0.7.4 verification

This release changes the display name to OB Citizen. The plugin ID remains citizen; room and checkpoint protocol remain 14. The existing repository URL and historical release archives are retained.

- Production build and TypeScript checking: passed.
- Automated tests: 238 passed, 0 failed.
- Metadata audit: manifest, package metadata, lockfile, and compatibility map use version 0.7.4; the display name is OB Citizen and the plugin ID is citizen.
- Current source/UI name audit: no former display name remains in the runtime source, manifest, package metadata, or release workflow.
- Tracked-source and production-bundle scan: no known local checkout paths or credential markers found.
- Original historical manifest-name fields, archive filenames, and hashes are retained as evidence of the packages actually distributed.

The release workflow builds from the version tag, runs the tests, packages the three plugin files, and creates checksums. Publication requires separate downloaded-asset verification. Native gameplay and cross-computer connectivity are not revalidated by this naming change.

## Publication and directory result

- GitHub Actions run 38940687399 completed successfully on the 0.7.4 tag.
- Downloaded all five draft assets; checked GitHub digests, sizes, SHA256SUMS.txt, the manifest, and the ZIP's exact three members before publishing.
- Scanned downloaded plugin files for known private checkout paths, credential markers, and the former runtime display name; none were found.
- Published OB Citizen 0.7.4 as the latest release. Existing release titles now use OB Citizen; their original artifact bytes and hashes remain intact.
- The Community form accepted the new name and created the independent citizen entry. Published the listing and added JusVibin / xjusvibin as a contributor.
- The automated review subsequently flagged OB Citizen as including part of the Obsidian name. The public listing's Add to Obsidian button was disabled while review remained pending. This release does not claim directory review approval.
