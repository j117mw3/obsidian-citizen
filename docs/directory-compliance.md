# Directory review follow-up

## Current result: Citizen 0.7.6 passed

The published 0.7.6 release at commit `5c82955851173e008088bca882db605fab5ab73c` completed directory review with **Health Excellent** and **Review Passed**. The trademark-name rejection, source/CSS warnings, and unsupported release-asset recommendation are resolved. Five scanner-incompatible Array.at calls were replaced with equivalent indexed access after the first preview. The directory verified provenance attestations, dependencies, network patterns, and a byte-for-byte reproducible build. Necessary vault-enumeration and user-triggered clipboard recommendations remain.

See [0.7.6 verification](verification-0.7.6.md) for hashes, workflow evidence, screenshot, and native-runtime limits. The sections below preserve the earlier 0.7.4/0.7.5 investigation and naming comparison.

## Earlier investigation

The 0.7.4 release failed the completed automated directory review. The following source changes are candidates for branch review; they are not yet part of a new published release.

- Move the player-indicator arrow's static reset to a CSS class. Dynamic offscreen rotation uses a CSS custom property; the onscreen class resets it with ordinary stylesheet precedence.
- Remove the redundant settings introduction heading. The first preview also prohibited General, so the introduction now starts with its descriptive paragraph.
- Name the command Open graph; Obsidian already prefixes it with the plugin name. The ribbon and view retain the chosen OB Citizen branding.
- Point manifest authorUrl at the maintainer's GitHub profile.
- Enable the repository issue tracker for support.
- Schedule and cancel Hangar animation frames on the panel's owning window.

Validation: production build with TypeScript checking passed; 238 automated tests passed with zero failures. No additional test duplicates these static naming/style changes. Native visual acceptance is not claimed.

The chosen name OB Citizen remains unchanged. It is separately flagged by the directory's manifest name check and needs a directory-team ruling or a newly selected name. Other typed-code, DOM-helper, and CSS warnings in the original report are not all resolved by this focused correction. ZIP/checksum extras and vault/clipboard access are recommendations, not blocking errors; release archives are intentionally retained.

## Controlled naming comparison

- Main source commit 48b3ab4 retains OB Citizen and removes the redundant heading completely.
- Diagnostic commit 19e531c357c155393c170c7baa8fce0afc5345c5 differs from that main source only in manifest.json: the display name is Citizen instead of OB Citizen. Repository URL, plugin ID, package metadata, and all other files are identical.
- The directory preview for diagnostic commit 19e531c completed with zero errors. It reports a warning that Citizen differs from the existing listing's OB Citizen name; it does not report the trademark-name error.
- The same repository slug therefore does not independently cause the reported name rejection. Whether rejecting OB Citizen is the intended policy or an overbroad check remains a directory-team question.
- The successful diagnostic also verifies removal of the two original source errors and the redundant-General-heading error, plus the author-profile and disabled-issues warnings. Remaining source/CSS warnings are still visible.
- This is a branch-only diagnostic, not a renamed public release. Version 0.7.4 remains the published release; the corrected source awaits a future release after the name decision.
