# CloudVault — Product Requirements Document (PRD)

---

## 1. Product Overview

CloudVault is an enterprise S3 file management platform consisting of two tightly coupled applications:

1. **enterprise-file-management** — A Next.js 14 web application serving as the "control plane." Admins manage tenants, users, teams, buckets, bots, file shares, and audit logs.
2. **electron-app** — An Electron desktop agent that runs on-premise. It syncs files between a local filesystem and S3 buckets via the web app's API, supporting both human and headless (bot) operation.

The web app is the source of truth; the desktop agent is the execution engine.

---

## 2. Problem Statement

Enterprises need to:
- Manage S3 buckets across multiple AWS accounts from a single dashboard
- Control which users/teams can access which buckets (RBAC)
- Run automated, headless sync agents on servers without human login
- Share individual files securely with external parties (expiry, download limits, password protection)
- Audit every action for compliance
- Sync files bidirectionally between local machines and cloud storage

---

## 3. Target Users

| Persona | Description |
|---|---|
| Platform Admin | Manages all tenants, users, and global infrastructure |
| Tenant Admin | Manages users, teams, buckets, and bots within their organization |
| Team Admin | Manages their team's members and resource policies |
| Teammate | End user with access only to explicitly granted resources |
| Bot/Agent | Headless machine identity performing automated sync operations |

---

## 4. User Roles & Access Control

| Role | Capabilities |
|---|---|
| `PLATFORM_ADMIN` | Full access to everything — all tenants, all users, superadmin panel. Bypasses tenant isolation checks. |
| `TENANT_ADMIN` | Full access within their tenant — users, teams, buckets, bots, shares, audit |
| `TEAM_ADMIN` | Manages their team's members and policies |
| `TEAMMATE` | Access only to resources explicitly granted via `ResourcePolicy` |

Access is enforced via:
- `ResourcePolicy` table (user/team → actions on resources)
- `withTenantAccess` middleware (tenant isolation on all API routes)
- IP allowlist per team (blocks access from non-allowed IPs)

---

## 5. Authentication Flows

### 5.1 Web App — Human Login
1. Email + password → Cognito `InitiateAuth` → RS256 JWT
2. `NEW_PASSWORD_REQUIRED` challenge handling
3. Google SSO via Cognito Hosted UI
4. Tokens stored as HTTP-only cookies
5. Token refresh via stored refreshToken
6. Forgot/reset password flow via Cognito
7. IP blocking enforcement at login (team `allowedIps`)

### 5.2 Desktop Agent — Human SSO (PKCE Loopback)
1. App generates PKCE verifier + challenge (SHA-256)
2. Starts local HTTP server on random port
3. Opens system browser to web app's `/api/auth/agent-sso` endpoint
4. User authenticates in browser → web app generates one-time auth code
5. Browser redirects to loopback server with code
6. App exchanges code + verifier for tokens via `/api/auth/token-exchange`
7. Tokens stored in encrypted `electron-store`

### 5.3 Desktop Agent — Bot/Machine Auth (Secretless)
1. Admin generates Ed25519 key pair in Electron app
2. Public key registered in web app (Bots page) with bucket-scoped permissions
3. Web app returns `botId` → pasted into Electron app
4. At runtime: Electron signs JWT with Ed25519 private key
5. Calls `POST /api/bot/verify` → server verifies EdDSA signature
6. Server issues HS256 `accessToken` (15 min TTL) + `refreshToken` (7 days TTL)
7. Auto-login on startup if key pair + botId exist
8. Private key encrypted at rest using machine-specific key (hostname + username hash)

---

## 6. Web Application Features

### 6.1 Dashboard (`/`)
- Stats cards: Total Files, Total Storage, Active Buckets, Monthly Cost (estimated $0.023/GB)
- Cost Trend chart (area chart, monthly)
- Storage by Bucket chart (horizontal bar)
- Recent Activity feed (last 6 audit log entries)
- Quick Actions: Upload Files, Create Bucket, View Audit Logs, Search Files
- Time range filter: Today, 7d, 14d, 30d, All Time, Custom (max 30 days)

### 6.2 Buckets (`/buckets`)
- List all buckets in the tenant
- Create bucket (name, region, link to AWS account)
- View bucket details, quota usage (default 100GB per bucket)
- Trigger manual S3 sync (re-index files from S3 into DB)
- Delete bucket
- Versioning and encryption flags per bucket

### 6.3 Files (`/files`)
- Browse files within a bucket
- Upload files (single, multi, folder)
- Multipart upload for large files (initiate → sign parts → complete/abort)
- Create folders
- Download files (presigned S3 URL)
- Delete files, rename files
- Share files (creates a `Share` record)

### 6.4 Explorer (`/explorer`)
- Full-text search across all files in the tenant
- Uses PostgreSQL `tsvector` GIN index for fast FTS
- Falls back to Prisma ORM `contains` query
- Results scoped by RBAC policies for TEAMMATE role

### 6.5 File Explorer (`/file-explorer`)
- Hierarchical folder browser (tree view)
- Navigate into folders, list children

### 6.6 Shares (`/shares`)
- List all active shares created by the user
- Create share: pick file, set expiry date, download limit, optional password
- Revoke shares
- Public share page at `/file/share/[shareId]` — no login required
  - Password-protected shares show auth form first
  - Tracks download count, enforces limit, checks expiry

### 6.7 Audit (`/audit`)
- Full audit log table with filters: action type, user, date range, tenant
- Every upload, download, delete, share, login, bucket create/delete is logged
- Includes IP address, country, region (via MaxMind GeoIP)

### 6.8 Teams (`/teams`)
- Create and manage teams within the tenant
- Add/remove members
- Set IP allowlist per team
- Assign resource policies to teams

### 6.9 Users (`/users`)
- List all users in the tenant
- Invite users (creates user record + Cognito account)
- Assign roles
- Deactivate users

### 6.10 Bots (`/bots`)
- List all registered bot identities
- Register new bot: name + public key PEM + bucket permission matrix
- View bot status (Active/Revoked), connection status (Online/Offline via heartbeat)
- View last used timestamp, machine info, diagnostics
- Click into a bot to see activity log and edit permissions
- Revoke bot (deletes identity, invalidates all tokens)

### 6.11 Accounts (`/accounts`)
- Manage AWS accounts linked to the tenant
- Two models:
  - Legacy: access key + secret key
  - BYOA (Bring Your Own Account): cross-account IAM role (roleArn + externalId) via STS AssumeRole
- Account validation status tracking (CREATING → PENDING_VALIDATION → CONNECTED → FAILED → DISCONNECTED)

### 6.12 Settings (`/settings`)
- User preferences: theme mode (light/dark/system), theme color, font, border radius

### 6.13 Superadmin (`/superadmin`) — PLATFORM_ADMIN only
- Manage all tenants (create, view, delete)
- Manage all users across tenants
- Manage AWS accounts globally
- Manage all buckets globally
- Platform-wide statistics

---

## 7. Desktop Agent Features

### 7.1 Authentication
- Cognito direct login (email + password)
- Browser SSO via PKCE loopback
- Bot/machine auth (Ed25519 key pair)
- Proactive token refresh (5 min before expiry)
- Auto-login on startup for bots
- On logout: wipes all local SQLite data

### 7.2 Sync Engine
- On login: immediately runs `syncAll()` to pull tenant/account/bucket/file metadata
- Periodic sync: every 1 minute checks for configs due to run
- Per-config sync: each `SyncConfig` has an interval, direction (DOWNLOAD/UPLOAD), and mappings (local folder ↔ bucket)

**DOWNLOAD mode:**
- Fetches file list from local DB
- For each file: checks if it exists locally with matching size/ETag
- If missing or changed: gets presigned download URL, streams file to disk
- Prevents re-upload loop via `downloadingPaths` Set

**UPLOAD mode:**
- Walks local folder recursively
- For each local file: checks if it exists in S3 and if size/mtime changed
- If new or modified: queues an upload task
- File watcher (chokidar) triggers real-time uploads for UPLOAD configs with `useWatcher = true`

### 7.3 File Watcher
- Uses `chokidar` to watch configured local folders
- Events: `add`, `change`, `unlink`, `addDir`, `unlinkDir`
- Only active for UPLOAD-direction configs with watcher enabled

### 7.4 Transfer Queue
- Uploads and downloads are queued with progress tracking
- Status broadcast to renderer via IPC (`transfer-status-update`)
- Pause, resume, terminate individual transfers

### 7.5 Local Database (SQLite)
- Mirrors server data: Tenant, Account, Bucket, FileObject
- Additional tables: SyncConfig, SyncMapping, SyncJob, LocalSyncActivity, SyncState
- WAL mode for concurrent read/write safety
- Wiped on logout

### 7.6 System Monitoring
- Network stats (rx/tx bytes per second) — polled every 1 second
- Disk stats (total/used/available) — polled every 10 seconds
- Broadcast to renderer via IPC

### 7.7 Heartbeat & Health
- Pings `/api/heartbeat` periodically to keep session alive
- Health reporter pushes diagnostics + machine info to server
- If 401 received → fires `auth-expired` event

### 7.8 Doctor Diagnostics
- Clock Skew detection
- Disk I/O check
- Multipart Handshake test
- Proxy Detection
- Service Health check

### 7.9 Desktop UI Pages
| Page | Purpose |
|---|---|
| Login | Three modes: email/password, SSO, bot auth |
| Dashboard | Overview stats, quick actions |
| Buckets | List synced buckets from server |
| Files | Browse files within a bucket |
| Explorer | Search across all local files |
| Sync | Manage sync configs (create, edit, delete, trigger) |
| Sync History | View past sync jobs and activities |
| Recent Activities | View all local sync activities |
| Doctor | Run diagnostics, view heartbeat history |

---

## 8. File Sharing

- Share links are UUIDs (not guessable)
- Optional bcrypt password protection
- Configurable expiry date (enforced server-side)
- Configurable download limit (enforced server-side)
- Status tracking: ACTIVE, EXPIRED, REVOKED
- Public download page requires no login

---

## 9. Multi-Tenancy

- All data is scoped to a `Tenant`
- One tenant can be designated as a "hub" tenant (`isHubTenant`)
- `withTenantAccess` middleware enforces tenant isolation on all API routes
- `PLATFORM_ADMIN` bypasses tenant isolation
- Users are uniquely identified by `(email, tenantId)` — same email can exist in multiple tenants
- Bots are scoped to a tenant

---

## 10. Known Issues & Gaps

1. **Bot permission enforcement** — Only `/api/agent/sync` and `/api/heartbeat` enforce bucket-scoped permissions. 10+ other routes do not yet validate bot permissions. Documented in `BOT-PERMISSION-AUDIT.md`.
2. **Sync history scoping** — `SyncHistory` records are not yet scoped to a specific bot or user.
3. **Error handling for DB disconnection** — noted as a TODO.
4. **Agent tab in web app** — planned for the Collaboration section.
