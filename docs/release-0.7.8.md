# Citizen 0.7.8 public release verification

Public 0.7.8 consolidates all changes developed after public 0.7.7. Local candidates numbered 0.7.8 through 0.7.14 were never individual public releases. Their original verification records, hashes and backup labels remain historical evidence; see [candidate history](local-candidate-history.md). The final candidate's departure fixes are documented in [its verification record](verification-0.7.14.md).

## Validation of the renumbered release

- `node --test --import=./dev/worker-isolated-preload.mjs`: 272 passed, zero failed. Temporary Worker storage isolates the existing local database. Local log: `dist/release-0.7.8-tests.log`.
- `npm run lint`: passed, including CSS review.
- `npm run build`: passed, including TypeScript checks.
- `git diff --check`: passed.
- Source manifest, package and lockfile versions are 0.7.8; update history ends at 0.7.8. The plugin ID remains `citizen`, minimum desktop Obsidian version 1.7.2, room/checkpoint protocol 15.
- The archive contains only `main.js`, `manifest.json` and `styles.css`. Release bundle checks found no local user or vault path markers. Settings and profiling captures are excluded.

## Package SHA-256

```text
1b4dd5a3d1a6d3f1f4efffa98c368380d40870a1051d8d4eb124e58e8bba4383  main.js
9d92c5ef4268981dd234ab2ed0a575feef639fe554084ccbe8ccb3fb2311734c  manifest.json
41592ebe40bc4f3aba78392e03920744eddc9a196e672e226859a9eb9c851a40  styles.css
f2ccd2bfafc34a2af85fb16132cb738946559c817c749b7349979b5eaf315c24  citizen-0.7.8.zip
```

## Update and acceptance boundaries

Public 0.7.7 users update to 0.7.8. All room participants must update because protocol 15 replaces protocol 14. Testers on unpublished 0.7.9–0.7.14 candidates must manually install 0.7.8 once: their previous candidate numbers are greater than the public release number. Saved settings must be retained.

The default branch and GitHub latest release must both advertise 0.7.8, with individually downloadable plugin files for Obsidian's updater. Publication verification compares downloaded release assets with the hashes above.

Automated tests do not establish native sustained FPS, flicker resolution or complete resolution of intermittent departure problems. Reload/redock, moving-wall observation, repeated departures and cross-computer gameplay remain native acceptance items. Publishing this release does not change those limits.
