# ProjectFlow Technical Overview

## Executive Summary

ProjectFlow is a TypeScript monorepo for lightweight project and task tracking. It contains a NestJS REST API backed by MongoDB/Mongoose and a Next.js App Router web application. The API owns authentication, authorization, validation, persistence, and business rules. The web application is a client of that API and uses TanStack Query for server state. `packages/shared` provides domain enums, limits, and API response types shared by both applications.

The main assessment concern is an authorization bypass in the task-status endpoint: `PATCH /tasks/:taskId/status` requires a valid JWT but does not check whether the authenticated user can access the task's project. This should be fixed before treating the endpoint as production-ready.

## 1. Tech Stack & Libraries

### Repository and language

- TypeScript 5.9.3 across the workspace.
- pnpm 10.33.0 workspaces for package management.
- Turborepo 2.10.12 for task orchestration across packages and apps.
- Node.js 20.19 or newer, based on the root `engines` declaration.
- Shared workspace packages:
  - `@projectflow/shared`: domain enums, constants, DTO response types, and role helpers.
  - `@projectflow/eslint-config`: shared ESLint configuration.
  - `@projectflow/tsconfig`: shared TypeScript configurations.

### Backend

- NestJS 11 with `@nestjs/platform-express` as the HTTP adapter.
- MongoDB accessed through Mongoose 8 and `@nestjs/mongoose`.
- `class-validator` and `class-transformer` for DTO validation and request transformation.
- `@nestjs/config` and `dotenv` for environment configuration.
- JWTs issued and verified with `@nestjs/jwt`.
- Password hashing with `bcryptjs`, configured to use 12 rounds.
- `helmet` for common HTTP security headers.
- RxJS, as required by NestJS.
- Jest 30, Supertest, and `mongodb-memory-server` for end-to-end API tests.

### Frontend

- Next.js 16.3.4 using the App Router.
- React 19.2.8 and React DOM 19.2.8.
- TanStack Query 5 for server-state fetching, caching, retries, and invalidation.
- React Hook Form with `@hookform/resolvers` and Zod 4 for form handling and client-side schemas.
- Tailwind CSS 4 for styling.
- Radix UI primitives for accessible dialogs, menus, selects, labels, separators, avatars, and slots.
- Phosphor Icons for application icons.
- `sonner` for toast notifications.
- `clsx`, `tailwind-merge`, and `class-variance-authority` for class composition.

### State and authentication strategy

- Server state is managed by TanStack Query. Query keys are centralized in `apps/web/src/lib/query-keys.ts`.
- Local UI state uses React state and component state; there is no Redux, Zustand, or other global client store.
- Authentication uses stateless JWT bearer access tokens.
- The browser stores the access token in `localStorage` under `projectflow.accessToken`.
- `apps/web/src/lib/api-client.ts` reads the token and sends it as `Authorization: Bearer <token>` on non-anonymous requests.
- There is no refresh-token flow, token revocation mechanism, or server-side session store.

## 2. Architecture & File Structure

### Monorepo layout

```text
apps/
  api/                    NestJS REST API
    src/
      auth/               Registration, login, and current-user endpoints
      users/              User persistence and lookup
      organizations/      Organization lookup and organization summaries
      organization-members/
                          Organization membership and organization roles
      projects/           Project endpoints, project business logic, access service
      project-members/    Project membership and project roles
      tasks/              Task endpoints and task business logic
      comments/           Comment endpoints and comment business logic
      common/             Global guards, decorators, filters, DTOs, utilities
      database/seed.ts    Development database reset and seed data
    test/                 API end-to-end tests and fixtures
  web/                    Next.js App Router frontend
    src/
      app/                Routes, layouts, error and not-found boundaries
      components/         App shell, navigation, and reusable UI primitives
      features/           Feature-specific APIs, hooks, and components
        auth/
        projects/
        tasks/
        comments/
      lib/                API client, auth storage, query keys, formatting
      providers/          TanStack Query provider
packages/
  shared/                 Types, enums, constants, and role helpers
  eslint-config/          Shared lint configuration
  tsconfig/               Shared TypeScript configuration
```

### Backend layering

The backend follows a conventional NestJS module structure:

1. Controllers define HTTP routes and convert route/user IDs to MongoDB `ObjectId` values.
2. DTOs validate incoming request bodies and query parameters.
3. Services contain business rules, authorization checks, data aggregation, and serialization.
4. Mongoose schemas define MongoDB collections and indexes.
5. Shared serialization utilities prevent persistence documents and credential fields from leaking directly through the API.

`apps/api/src/app.module.ts` registers MongoDB, all feature modules, a global `JwtAuthGuard`, and a global exception filter. `apps/api/src/main.ts` enables Helmet, configured CORS, and a global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted` enabled.

The API is organized around domain modules rather than a separate repository layer. Services inject Mongoose models directly. `ProjectAccessService` is the main shared authorization abstraction for project-scoped resources.

### Frontend structure and API communication

- `apps/web/src/app/layout.tsx` provides global metadata, font setup, the TanStack Query provider, and the toaster.
- The `(app)` route group renders `AppShell`, which loads the current user and projects and redirects to `/login` when the token is absent or `/auth/me` fails.
- Feature API files such as `features/auth/api.ts`, `features/projects/api.ts`, and `features/tasks/api.ts` call the centralized `lib/api-client.ts`.
- Feature hooks wrap those API calls with TanStack Query and mutations. Mutations invalidate affected project/task queries after success.
- Next.js is not being used as a backend-for-frontend here. Browser code calls the NestJS API directly using `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:4732`.
- The API returns JSON and uses a shared `ApiErrorBody` shape for errors. The frontend converts failures into `ApiError` instances with an HTTP status code.

### Current API surface

```text
POST   /auth/register
POST   /auth/login
GET    /auth/me

GET    /organizations

GET    /projects
POST   /projects
GET    /projects/:projectId
GET    /projects/:projectId/members
POST   /projects/:projectId/members

GET    /projects/:projectId/tasks
POST   /projects/:projectId/tasks
GET    /tasks/:taskId
PATCH  /tasks/:taskId
PATCH  /tasks/:taskId/status
DELETE /tasks/:taskId

GET    /tasks/:taskId/comments
POST   /tasks/:taskId/comments
```

## 3. Authentication & Authorization

### Authentication flow

1. `POST /auth/register` and `POST /auth/login` are marked with `@Public()`, which opts them out of the global JWT guard.
2. Registration lowercases the email, hashes the password with bcrypt, creates the user, and returns a session.
3. Login fetches the password hash explicitly because `User.passwordHash` is `select: false`, compares it with bcrypt, and returns a session on success.
4. `AuthService.buildSession()` signs a JWT containing `sub` (user ID) and `email`. The configured lifetime defaults to seven days through `JWT_EXPIRES_IN`.
5. The frontend stores the access token in `localStorage`. The API client attaches it to every request unless the request is marked `anonymous`.
6. `GET /auth/me` resolves the JWT subject against the database and returns the user plus organization memberships and roles.

`UserSchema` also removes `passwordHash` in its JSON transform as defense in depth. Login errors use the same generic message for unknown emails and wrong passwords, which reduces account-enumeration detail.

### Global authentication guard

`apps/api/src/common/guards/jwt-auth.guard.ts` is registered as an `APP_GUARD`, so every route is protected by default. It:

- Reads the `Authorization` header.
- Requires the `Bearer` scheme.
- Verifies the JWT using the Nest JWT service and configured secret.
- Attaches only `{ id, email }` to `request.user`.
- Returns `401` for missing, invalid, or expired tokens.

Routes opt out only through the `@Public()` decorator. `@CurrentUser()` reads the user attached by the guard.

### Resource authorization

`ProjectAccessService` resolves a project and checks two memberships in parallel:

- Organization membership, for inherited organization-level access.
- Project membership, for explicit project access.

The effective policy is:

- Organization `OWNER` and `ADMIN` roles can view and manage every project in that organization.
- A project member can view the project, its tasks, and its comments.
- A `PROJECT_MANAGER` can manage project membership and project configuration.
- A regular project member can create tasks and edit tasks they created.
- Deleting a task requires project-management permission.
- Adding a project member requires project-management permission and requires the target user to belong to the organization.

The following paths correctly reuse project authorization:

- Project detail and project member reads use `assertCanView`.
- Task list, task creation, task detail, general task update, and task deletion use `assertCanView` or `assertCanManage`.
- Comment listing and creation resolve the task first, then call `assertCanView` for the task's project.

### Important authorization gap

`TasksController.updateStatus()` does not inject `@CurrentUser('id')`. It calls `TasksService.updateStatus(taskId, dto)`, and that service only loads and saves the task. Consequently, any caller with any valid JWT can change the status of any task if they know its ID, including tasks in projects they cannot access.

This is a server-side authorization bypass, not merely a frontend visibility issue. The endpoint should accept the authenticated user ID and call `ProjectAccessService.assertCanView()` or a more specific status-transition permission check before saving. Add a regression test for an outsider receiving `403`.

## 4. Data Models & Relationships

MongoDB stores relationships as referenced `ObjectId` fields and separate membership collections. There are no Mongoose `populate()` calls in the main service paths; related records are loaded explicitly and converted into shared response types.

### User

Collection: `users` (`apps/api/src/users/schemas/user.schema.ts`)

- `name`
- unique, lowercased, indexed `email`
- bcrypt `passwordHash`, excluded from normal queries
- optional `avatarUrl`
- automatic `createdAt` and `updatedAt` timestamps

A user can belong to many organizations through `OrganizationMember` and many projects through `ProjectMember`. Users also create tasks and author comments.

### Organization

Collection: `organizations` (`apps/api/src/organizations/schemas/organization.schema.ts`)

- `name`
- unique, lowercased, indexed `slug`
- `ownerId` reference to `User`
- automatic timestamps

An organization owns many projects and has many users through `OrganizationMember`.

### OrganizationMember

Collection: `organization_members` (`apps/api/src/organization-members/schemas/organization-member.schema.ts`)

- `organizationId` reference to `Organization`
- `userId` reference to `User`
- `role`: `OWNER`, `ADMIN`, or `MEMBER`
- unique compound index on `{ organizationId, userId }`

This is the organization-level access-control join collection. `OWNER` and `ADMIN` are elevated roles that inherit access to every project in the organization.

### Project

Collection: `projects` (`apps/api/src/projects/schemas/project.schema.ts`)

- `organizationId` reference to `Organization`
- `name`
- uppercase `key`, validated against the shared project-key pattern
- optional `description`
- `createdBy` reference to `User`
- automatic timestamps
- unique compound index on `{ organizationId, key }`

A project belongs to one organization, has many project members and tasks, and is accessible through organization role inheritance or explicit project membership.

### ProjectMember

Collection: `project_members` (`apps/api/src/project-members/schemas/project-member.schema.ts`)

- `projectId` reference to `Project`
- `userId` reference to `User`
- `role`: `PROJECT_MANAGER` or `MEMBER`
- unique compound index on `{ projectId, userId }`

This is the project-level access-control join collection.

### Task

Collection: `tasks` (`apps/api/src/tasks/schemas/task.schema.ts`)

- `projectId` reference to `Project`
- per-project numeric `number`
- human-readable `key`, derived as `{project.key}-{number}` such as `ENG-1`
- `title` and optional `description`
- `status`: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, or `DONE`
- `priority`: `LOW`, `MEDIUM`, `HIGH`, or `URGENT`
- `createdBy` reference to `User`
- indexes for project/status, project/number, and creation time
- automatic timestamps

A task belongs to one project and can have many comments. Task summaries include the creator and an aggregate comment count.

### Comment

Collection: `comments` (`apps/api/src/comments/schemas/comment.schema.ts`)

- `taskId` reference to `Task`
- `authorId` reference to `User`
- trimmed, length-limited `content`
- automatic timestamps
- index on `{ taskId, createdAt }`

Comments are only readable or creatable by users who can view the task's project. Deleting a task explicitly deletes its comments with `Promise.all`.

### Relationship summary

```text
User 1 ---- many OrganizationMember many ---- 1 Organization
User 1 ---- many ProjectMember      many ---- 1 Project
Organization 1 ---- many Project
Project 1 ---- many Task
Task 1 ---- many Comment
User 1 ---- many Task        (createdBy)
User 1 ---- many Comment     (authorId)
```

## 5. Codebase Risks & Weaknesses

### 1. Critical: task-status authorization bypass

**Evidence:** `apps/api/src/tasks/tasks.controller.ts` and `apps/api/src/tasks/tasks.service.ts`, in `updateStatus()`.

The route is protected only by authentication. It does not receive the current user and does not call `ProjectAccessService`. Any authenticated user who obtains a task ID can change its status across projects.

**Action:** Fix now. Pass the user ID through the controller and assert project access before mutation. Add e2e coverage for an outsider and for a permitted member. Consider whether status updates should allow all viewers, creators only, or managers only, then encode that policy centrally.

### 2. High: access tokens are exposed to JavaScript through `localStorage`

**Evidence:** `apps/web/src/lib/auth-storage.ts` and `apps/web/src/lib/api-client.ts`.

Any successful XSS in the frontend can read the bearer token and reuse it until expiry. The current default lifetime is seven days, and there is no refresh/revocation path. The seed data and development workflow also make it easy to overlook this difference between local and production security.

**Action:** Fix before production. Prefer a short-lived access token plus a refresh token in a `Secure`, `HttpOnly`, `SameSite` cookie, with rotation and revocation. At minimum, reduce access-token lifetime and define an incident response/revocation strategy. Keep the current approach only for a clearly isolated assessment/demo environment.

### 3. High: task numbering is race-prone and lacks a uniqueness constraint

**Evidence:** `apps/api/src/tasks/tasks.service.ts` calculates `number` using `countDocuments({ projectId }) + 1`; `apps/api/src/tasks/schemas/task.schema.ts` has no unique `{ projectId, number }` index.

Two concurrent task creations can observe the same count and produce duplicate numbers and keys, such as two `ENG-7` tasks. Counts also become unsafe if tasks are deleted because the next number can be reused.

**Action:** Fix before production or before demonstrating concurrent behavior. Use an atomic per-project counter, a transaction/counter collection, or a retryable sequence allocation, and add a unique compound index on `{ projectId, number }` as a final integrity guarantee. Add a concurrency test.

### 4. Medium: no refresh, logout invalidation, or user revalidation after token issuance

**Evidence:** `apps/api/src/auth/auth.service.ts`, `apps/api/src/common/guards/jwt-auth.guard.ts`, and `apps/web/src/features/auth/hooks.ts`.

Logout only removes the token from the current browser. Already-issued tokens remain valid until expiry. The guard trusts the JWT payload and does not check that the user still exists or is disabled on every request. Membership changes are reflected by later authorization lookups, but account deletion or credential compromise has no immediate invalidation mechanism.

**Action:** Fix as part of production auth hardening. Add refresh-token rotation and a revocation/version mechanism, or maintain a server-side session/token deny-list for urgent invalidation. A database existence check in the guard improves correctness but adds a database lookup to every protected request.

### 5. Medium: open registration is enabled without abuse controls

**Evidence:** `POST /auth/register` is public in `apps/api/src/auth/auth.controller.ts`, and there is no visible rate limiting, email verification, CAPTCHA, or account lockout flow.

If the service is deployed beyond a trusted internal environment, attackers can create unlimited accounts and potentially use registration as an abuse or resource-exhaustion vector. The DTO validates format and password length but does not establish password strength or verification.

**Action:** Decide based on product scope. For an invite-only workspace, disable public registration and create users through an administrative flow. For public registration, add rate limiting, email verification, stronger password policy, monitoring, and abuse controls before launch.

### 6. Medium: task deletion and comment deletion are not transactional

**Evidence:** `apps/api/src/tasks/tasks.service.ts` uses `Promise.all([commentModel.deleteMany(...), task.deleteOne()])`.

If one operation fails after the other succeeds, the database can retain orphaned comments or remove a task while leaving comments behind. This is a consistency risk that becomes more relevant as data volume and operational failures increase.

**Action:** Fix when deletion is a production workflow. Use a MongoDB transaction when the deployment supports transactions, or use a tested cleanup strategy and idempotent retry behavior. Add a failure-path test if deletion is important to the assessment.

### 7. Low to medium: frontend route protection is client-side and can briefly render a loading shell

**Evidence:** `apps/web/src/components/layout/app-shell.tsx` performs the redirect in `useEffect` after rendering.

This is acceptable because the API remains the security boundary, but it can cause a flash of the app shell for unauthenticated users and does not provide server-side route protection. It also depends on the browser having access to the token, which prevents secure server-side session checks with the current storage strategy.

**Action:** Improve later, alongside cookie-based sessions. Add middleware or server-side session validation if authenticated pages need stronger navigation behavior. Do not rely on this frontend check for authorization.

## Assessment Priorities

1. Fix and test the missing authorization check in `updateStatus`.
2. Review the intended permission matrix and add negative tests for every project-scoped mutation.
3. Decide whether the assessment expects production-grade token storage; if so, replace `localStorage` bearer tokens with an HttpOnly-cookie refresh design.
4. Make task-number allocation atomic and enforce uniqueness in MongoDB.
5. Treat registration, token invalidation, and deletion transactions as follow-up hardening unless the assessment explicitly evaluates production readiness.

## Verification Baseline

The repository includes API e2e suites for authentication, projects, tasks, and comments under `apps/api/test`. Existing tests cover project access for listing, opening, and task creation/listing, but the task-status authorization bypass is not covered. Useful commands from the repository root are:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm test` uses `mongodb-memory-server`; the normal development seed uses the configured MongoDB instance and clears the ProjectFlow collections before inserting sample data.