# 0.7.14 local candidate: undocking clearance

## Report and confirmed defects

The user reports occasionally returning to a ship trapped in a node after leaving a planet, with movement input eventually helping it escape. Two contributing defects were reproduced in automated tests:

- Solo departure used the flight obstacle grid left over from before walking. That grid is intentionally paused on a planet, so departure clearance could miss a neighbour that moved into the exit. Solo grids also omitted enlarged neighbouring planet radii.
- Both shared room collision recovery and solo ship collision recovery divided the displacement from a node center by a fallback distance. At an exact-center overlap the displacement remains zero, so the ship cannot be pushed out without input moving it away from that point.

Both new regressions fail on the previous source and pass after the correction. Evidence: `dist/undock-before.log` and `dist/undock-after.log`. These demonstrate defects, not conclusive attribution of every native instance of the user's symptom.

## Changes

Solo undocking now forces a current collision-grid refresh before selecting a clear position. This bypasses walking/polling guards only for that departure and includes the actual world-space radii of nearby solo planets. Regular walking continues to skip flight-grid refreshes.

Exit-ray clearance now reserves 0.75 world units beyond each obstacle radius, plus the existing 0.05 interval nudge, covering the solo ship's 0.7 collision radius. Authoritative room departures use the same query; they retain host-selected positions rather than receiving a divergent client-side teleport.

Room authority/prediction and solo collision use one normal calculation for an exact-center overlap: opposite current velocity if available, otherwise a stable northward normal. Nonzero offsets retain the ordinary radial response. A stationary ship can therefore recover without movement input. Flight controls, health, zero departure velocity and multiplayer protocol 15 remain unchanged.

## Validation

- Exact-center recovery exercises stationary and moving ships through the shared grid and solo controller. Results are finite and outside their collision spheres.
- Solo departure starts with deliberately stale obstacle data, a moved neighbouring planet and an enlarged radius. The resumed ship clears the neighbour's actual envelope, despite the refresh timer being blocked.
- Multiplayer cases cover north and south poles, forced undocking and 120 ticks of held interaction input, with a large neighbour moved into the exit. Health remains 73, velocity remains zero, and the next collision resolution does not move the returned ship: no manual escape is needed in these fixtures.
- Existing first-attempt docking, surface entry/return, overlapping-neighbour exit-ray, world-frame and anonymous planet identity regressions remain enabled.
- `node --test --import=./dist/worker-isolated-preload.mjs`: **272 passed, 0 failed**. The documented temporary Worker storage setup preserves the existing Worker database. Log: `dist/undock-0.7.14-tests.log`.
- `npm run lint` (including CSS review), `npm run build` (including TypeScript checks), and `git diff --check` passed.

For a fresh checkout, the equivalent isolated test command is `node --test --import=./dev/worker-isolated-preload.mjs`. The tracked helper is byte-identical to the verification preload used above; local profiles, logs, backups and packages remain ignored.

## Delivery and native boundary

0.7.14 is installed on disk at `T:\AI\ObsidianVault\Obsidian\.obsidian\plugins\citizen`. Only the three release files were copied. The archive has exactly those three members; archive and installed assets were hash checked. The complete previous plugin directory was backed up and every backed-up file hash compared. Nothing was published remotely.

- Candidate: `dist/citizen-0.7.14-local-candidate.zip`.
- ZIP SHA-256: `A7A726C8D3789B5E02BB627BDA8DF26E064DBE7512532515F693A16E22490169`.
- Installed bundle SHA-256: `F24857504D42E7FBCF3098B78F225E6333ABDA5C14DD7F2B3BB511E690435039`.
- Full 0.7.13 backup: `dist/installed-backups/main-vault-before-0.7.14-20261017-6dfa26e5`.
- Settings preserved: SHA-256 `B693C97B5000C1ABB4BEC17F1B6499E96973920909C7946613D7C86BFAD1B558`.
- Installation record: `dist/citizen-0.7.14-local-install.json`.

No native UI automation or reload was performed in this follow-up. **Reload Citizen or restart Obsidian to load 0.7.14.** Native acceptance remains repeated departures from both poles, including a busy moving graph: the ship should appear clear of the planet and nearby nodes, remain controllable without corrective movement, and preserve health. The automated checks do not establish that the intermittent native symptom is completely resolved.
