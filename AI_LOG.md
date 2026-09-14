# AI Assistance Log

## Scope

AI assistance was used as a pair-programming aid during the assessment. The developer reviewed the repository changes and retained responsibility for requirements, design decisions, and validation.

## Prompts and Iteration

1. **Repository analysis:** Asked for a comprehensive technical overview covering the stack, architecture, authentication, data models, and risks. The result became `ASSESSMENT_NOTES.md`.
2. **Phase 2 security and concurrency:** Asked to fix task-status authorization, replace race-prone task numbering, add regression tests, and create `BUG_REPORT.md`. The implementation introduced authenticated status checks, an atomic per-project counter, a unique task-number index, and e2e coverage.
3. **Phase 3 assignment and activity:** Asked to add nullable task assignees, role-aware assignment rules, activity transitions, and a paginated activity endpoint. The implementation added shared response types, DTO validation, the `Activity` schema, batched user lookup, and server-side permission checks.
4. **Phase 4 and documentation:** Asked to build a role-aware frontend selector, activity timeline, scaling/code-review documentation, an AI log, and updated setup instructions. The final UI uses existing project-member data and the current-user/project-role model rather than introducing a new state library.

## Modified Code Suggestions

- Added `assignee` to task persistence and API response types, represented as a nullable user reference.
- Added `TaskActivityEntry` and structured previous/new assignee metadata to the shared package.
- Added `AssigneeSelector` with search filtering, loading skeletons, empty states, self-only member filtering, and disabled permission states.
- Added `ActivityTimeline` with human-readable assignment messages, avatars, timestamps, loading, error, and empty states.
- Added TanStack Query keys, API calls, and mutations for task assignment and activity history.
- Updated task detail composition to derive permissions from organization and project roles.
- Updated `README.md` and `ASSESSMENT_NOTES.md` with the current API surface, assignment rules, resolved findings, scaling design, and future priorities.

## Validation Performed

- Built `@projectflow/shared` to generate declarations used by both applications.
- Ran `pnpm --filter @projectflow/web typecheck` and `pnpm --filter @projectflow/web lint` for the frontend changes.
- Ran formatting and diagnostics checks on modified frontend and documentation files.

The AI did not create commits, branches, credentials, or external services. Runtime behavior still depends on the configured API and MongoDB environment.
