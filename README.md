# MeshChat — Remaining Development Plan

**Tagline:** Connect Without Internet.

This ZIP contains planning and verification documents only. It does not contain application source code, does not modify the current project, and does not instruct GitHub to delete files.

## Documents

- `IMPLEMENTATION_AUDIT.md` — what is present in the uploaded source ZIP and what is still incomplete.
- `REQUIREMENTS.md` — product, functional, security, privacy, and reliability requirements.
- `DEVELOPMENT_STAGES.md` — ordered implementation stages with completion criteria.
- `TESTING_CHECKLIST.md` — checks required before marking each feature complete.
- `FILE_CLEANUP.md` — files to preserve, documentation mismatches, and safe cleanup rules.

## Important project naming

- Repository/project folder in the uploaded ZIP: `MeshChart-main`
- GitHub repository name: `MeshChart`
- Application name: `MeshChat`

Keep the existing repository name and application ID unless a deliberate migration is planned.

## How to use this plan

1. Keep a backup of the current project ZIP and the working Termux project.
2. Add these documents to the repository, for example under `docs/plan/`.
3. Work through `DEVELOPMENT_STAGES.md` in order.
4. Do not mark a stage complete merely because its code exists. Use the acceptance checks in `TESTING_CHECKLIST.md`.
5. Do not delete files based only on `FILE_CLEANUP.md`; inspect and back them up first.

## Snapshot limitation

The uploaded ZIP is a repository snapshot. It does not include every newer uncommitted change described in the ongoing development conversation. In particular, the latest local packet-transport implementation and its tests were present in the Termux working project but are absent from the uploaded ZIP snapshot. The audit therefore distinguishes:
- what is visible in the uploaded ZIP;
- what was reported and verified in the current working project during this conversation; and
- what still needs Android compilation or real-device testing.

The current working project had 11 JavaScript tests passing, the Vite production build passing, and `git diff --check` passing on 2026-11-22. Native Android compilation and two-device BLE interoperability were not yet verified.
