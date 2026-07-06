# Stablecoin Ecosystem — Admin Console

A web dashboard for `admin-service`, covering every endpoint it exposes:
users (search, view, suspend/unsuspend, change role), transactions, bridge
transfers, system stats, and audit logs.

## Setup

```bash
cd apps/admin
npm install
cp .env.example .env   # point VITE_API_URL at your gateway if it's not on localhost:3001
npm run dev
```

Opens at `http://localhost:5175`.

## How it talks to your backend

This app **only calls the gateway** (`services/gateway`), exactly like the
mobile app does — never `admin-service` directly. It hits:

- `POST /auth/login`, `GET /auth/me`, `POST /auth/refresh` — for authentication
- `GET /admin/stats` — dashboard
- `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/:id/suspend`,
  `POST /admin/users/:id/unsuspend`, `PATCH /admin/users/:id/role` — user management
- `GET /admin/transactions` — transactions
- `GET /admin/bridge-transfers` — bridge transfers
- `GET /admin/audit-logs` — audit log

## Access control

Login is open to any user, but the app only renders the dashboard for roles
`ADMIN`, `SUPER_ADMIN`, and `COMPLIANCE` (checked client-side against
`GET /auth/me`). Anyone else sees a clear "not authorized" screen instead of
the console. Suspend / unsuspend / role-change actions are further restricted
to `ADMIN` and `SUPER_ADMIN` only — `COMPLIANCE` gets read-only access to
everything (view users, transactions, bridge transfers, audit logs) but won't
see the mutating action buttons.

Note: this is a **client-side** gate for UX purposes. The real enforcement
must live in `admin-service` itself (it currently only checks that a request
is authenticated via `AuthGuard('jwt')`, not that the caller actually holds an
admin-level role) — worth adding a role guard there too if you haven't already.

## 2FA

If an admin account has 2FA enabled, the login form automatically reveals a
6-digit code field after the first attempt (mirroring how the mobile app's
login flow handles the same `"2FA code required"` response from
`POST /auth/login`).

## Tech

Vite + React + TypeScript + Tailwind v4. No extra state library — a small
fetch-based API client (`src/lib/api.ts`) with automatic access-token refresh
on 401, and React Context for the current admin user (`src/lib/auth.tsx`).
