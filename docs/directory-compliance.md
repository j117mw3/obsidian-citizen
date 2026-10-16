# Directory review follow-up

The 0.7.4 release failed the completed automated directory review. The following source changes are candidates for branch review; they are not yet part of a new published release.

- Move the player-indicator arrow's static reset to a CSS class. Dynamic offscreen rotation uses a CSS custom property; the onscreen class resets it with ordinary stylesheet precedence.
- Use General for the settings introduction heading instead of repeating the plugin name.
- Name the command Open graph; Obsidian already prefixes it with the plugin name. The ribbon and view retain the chosen OB Citizen branding.
- Point manifest authorUrl at the maintainer's GitHub profile.
- Enable the repository issue tracker for support.
- Schedule and cancel Hangar animation frames on the panel's owning window.

Validation: production build with TypeScript checking passed; 238 automated tests passed with zero failures. No additional test duplicates these static naming/style changes. Native visual acceptance is not claimed.

The chosen name OB Citizen remains unchanged. It is separately flagged by the directory's manifest name check and needs a directory-team ruling or a newly selected name. Other typed-code, DOM-helper, and CSS warnings in the original report are not all resolved by this focused correction. ZIP/checksum extras and vault/clipboard access are recommendations, not blocking errors; release archives are intentionally retained.
