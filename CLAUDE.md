# Claude Code instructions

Follow the shared agent rules in AGENTS.md.

@AGENTS.md

## Code quality (all changes)

Follow `skills/releaseready-code-quality/SKILL.md` before writing code and before saying a change is done (full block in AGENTS.md). The check command is `npm run check`; it runs `npm run check:guardrails`, which `pr.yml` enforces on every PR.
