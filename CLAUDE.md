# Notes for AI assistants

- Read README.md "Rules" before touching `/sim`. Flag anything that could desync.
- Never add ROMs, extracted assets, or large disassembly to the repo. RE notes describe behavior in our own words.
- New RE findings go in `docs/re-notes/` with a confidence level (confirmed / likely / guess).
- Every change keeps `npm test` and `npm run typecheck` green. Determinism hash snapshots change only when sim rules change on purpose.
- The user is new to DS reverse engineering: explain ARM/DS specifics briefly when they come up.
