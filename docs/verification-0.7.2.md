# OB Citizen 0.7.2 verification

This release adds four shared combat bots per occupied planet, bot shots and +30 health drops, recognizable pickup visuals, a shared ten-player-kill limit, frozen round transitions, and space/docked pose preservation. Multiplayer messages and host checkpoints contain bounded bot state. Room protocol and combat checkpoint version are 14; older clients are rejected.

## Automated checks

The implementation turn ran 237 tests, TypeScript checking, the production build, and the network-harness build; all passed. Host snapshots and transfer checkpoints include bot/drop state; regressions cover bot combat, drop rewards, ten-kill scoring and round transitions. See individual tests in `tests/` and the user-facing changes in [CHANGELOG.md](../CHANGELOG.md).

## Not verified here

Native Obsidian visuals, audio and live gameplay, cross-computer WebRTC, and multiplayer visual continuity were not observed. Automated tests and a successful build do not establish native visual or gameplay acceptance.
