# Bug Report: Task Status Authorization Bypass

## Summary

`PATCH /tasks/:taskId/status` accepted any valid JWT and changed the target task without checking whether the authenticated user could access the task's project. The endpoint was protected by authentication, but not by resource authorization.

## Root Cause

`TasksController.updateStatus` did not extract the current user ID and called `TasksService.updateStatus` with only the task ID and requested status.

`TasksService.updateStatus` loaded the task, assigned the new status, and saved it directly. Unlike the other task operations, it never called `ProjectAccessService.assertCanView` or another project-level permission check.

The result was an insecure direct object reference pattern: a user who knew or guessed a task ID could mutate a task in a project where they had no organization or project membership.

## Impact

- Any authenticated account could change the workflow status of tasks outside its authorized projects.
- Project confidentiality was not directly exposed by this endpoint, but unauthorized status changes could corrupt project workflow, reporting, and operational decisions.
- The issue affected every task and every authenticated user, including users with no membership in the target organization.

Severity: High authorization defect.

## Reproduction Steps

1. Create or use two authenticated users: one project member and one outsider.
2. Create a project and task using the project member.
3. Keep the task ID from the create response.
4. As the outsider, send:

   ```http
   PATCH /tasks/{taskId}/status
   Authorization: Bearer {outsiderToken}
   Content-Type: application/json

   {"status":"DONE"}
   ```

5. Before the fix, the API returned `200` and changed the task status. The outsider should have received `403 Forbidden`.

The regression test is in `apps/api/test/tasks.e2e.spec.ts`.

## Fix Details

### Authorization fix

- `TasksController.updateStatus` now extracts `@CurrentUser('id')` and passes it to the service.
- `TasksService.updateStatus` resolves the task's project and calls `ProjectAccessService.assertCanView` before saving.
- Unauthorized users receive NestJS `ForbiddenException`, serialized by the global exception filter as HTTP `403`.

### Task-number concurrency fix

Task creation previously used `countDocuments({ projectId }) + 1`, which allowed concurrent requests to calculate the same number. The implementation now:

- Stores a per-project sequence in the `task_counters` collection.
- Uses MongoDB `findOneAndUpdate` with `$inc` and `upsert` to allocate numbers atomically.
- Retries duplicate-key counter upserts caused by concurrent first use.
- Enforces a unique compound index on `{ projectId, number }` in the task schema as a database integrity guarantee.

## Regression Prevention

Automated e2e tests now verify:

- An outsider receives `403` when attempting to change a task status.
- A failed unauthorized status update does not change the task.
- Twenty concurrent task creation requests return successful responses.
- Concurrent task numbers are unique and sequential from `1` through `20`.
- Concurrent task keys are unique.

Recommended future hardening:

- Add authorization tests for every task mutation and every project-scoped endpoint.
- Keep the unique `{ projectId, number }` index in production migrations and verify indexes during deployment.
- Add a migration or reconciliation process for existing tasks if deploying the counter collection to a database that already contains tasks.
- Add load or integration tests against the production MongoDB deployment mode, since concurrency behavior can differ from an in-memory test server.
