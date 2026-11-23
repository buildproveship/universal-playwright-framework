# Agent instructions

These rules apply to every agent and contributor working in this repository.

## Tests and classification

- **Every new or changed piece of logic ships with tests in the same change.** Prefer end-to-end (E2E) tests that exercise the real user or service path. Where E2E is not possible yet, add the clearest lower-level test (integration, contract, component or unit) and say in the pull request why E2E was not possible.
- **Classify every test file.** Each new or changed test file starts with a header in its own comment syntax:

  ```text
  Test classification: unit | component | contract | integration | e2e
  Review status: Not Reviewed
  Evidence: synthetic | real
  Scope: one sentence on what the test exercises and what it does not
  ```

  The classification describes scope, not the runner. Use the most conservative category for mixed files. Call a test `e2e` only when it goes through the real user or service path. In-memory compositions with test doubles are `integration`.

- **Only the founder reviews tests.** Never set a review status other than `Not Reviewed`, and never describe tests as reviewed or approved. Tests are onboarded into BuildProveShip, where they start as Not Reviewed and the founder reviews and approves them there.
- **Tests prove real outcomes.** Each guard has a test that fails if the guard is removed. Use synthetic fixtures unless real evidence is stated in the header.

## Design before implementation

This is the owner's standing rule for every project. A project's own rules may add to it but never relax it.

- **Keep the design library current.** Every new or changed design (screen, flow, component, state or copy) goes into the project's design library or design source of truth in the same piece of work. If the project has none, say so and propose where it should live. Do not leave a design only in code, a chat message or a pull request.
- **Implement only approved designs.** Do not build a design into the real product (application code, shared components adopted by an app, deployment) until the design is approved and the approval is recorded against the exact version of the design. Until then it is a draft.
- **Label drafts.** Say "draft" or "proposal" wherever an unapproved design appears. Never describe a design as approved, shipped or live without a recorded approval. Previews and prototypes made to get a design reviewed count as design work, not implementation. They use synthetic data and say they are previews.
- **Approval is the owner's.** Silence, a green build, a merged pull request or an agent's own review is not approval. When a design is ready for review, say where it is and what is waiting for approval.
- **No approved design, no implementation.** If asked to implement something that has no approved design, add the design to the library first, mark it for review, and report that implementation is waiting on approval. Fixing a bug that does not change a design is not covered.

## Code quality (all changes)

Follow `skills/buildproveship-code-quality/SKILL.md` before writing code and before saying a change is done: no legacy
or compatibility code without a named consumer; search npm, the SDK, the framework or the CLI before writing a
helper; import shared code from `@buildproveship/test-management`, TDM `dev-fixtures`, `@buildproveship/config`,
`@buildproveship/ui-web` or `@buildproveship/tokens`, never copy it; depend on published `^` versions only; never weaken
a lint rule, test or guard to go green, and give every disable comment a reason; READMEs describe today's code.
The check command is `npm run check`; it runs `npm run check:guardrails`, which `pr.yml` enforces on every PR.

## Local hooks and CI

- Husky runs the shared hooks from `@buildproveship/config` (`releaseready-hooks`): pre-commit (lint-staged, gitleaks), commit-msg (Jira key) and pre-push (never `main`, rebased, type-check, affected tests). Never use `--no-verify` or `HUSKY=0`.
- `npm install` installs the hooks through the `prepare` script.
- CI is one required check, `ci`, from the reusable workflow in `releaseready/config`; it runs `npm run build && npm run typecheck && npm run lint && npm run format:check && npm run check:guardrails && npm run test:unit`. Run the same command locally before you push.
- This repo is public, so its workflows run on GitHub-hosted `ubuntu-24.04` (a public repo never uses the self-hosted runner).

## Delivery rules

- Rules for people and agents: [How we work](https://noisegatemusicstudios.atlassian.net/wiki/spaces/RRDOCS/pages/27328513) and [Reuse first](https://noisegatemusicstudios.atlassian.net/wiki/spaces/RRDOCS/pages/27230233).
- Read only the ticket's **Agent brief** first ([template](https://noisegatemusicstudios.atlassian.net/wiki/spaces/RRDOCS/pages/26411190): Goal, Files, Done when, Blocked by/Reuses, Model); history and background are in the comments.
- Before you create a ticket, a branch or a helper, search Jira and the Reuse first list, then extend or link what exists.
- Fetch and rebase on `origin/main` before every push, open draft pull requests, and run the checks locally before CI.
