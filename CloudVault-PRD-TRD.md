# CloudVault — Product Requirements Document (PRD) & Technical Reference Document (TRD)

---

# PART 1: PRODUCT REQUIREMENTS DOCUMENT (PRD)

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

---

# PART 2: TECHNICAL REFERENCE DOCUMENT (TRD)

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              enterprise-file-management (Web App)                │
│                    Next.js 14 (App Router)                       │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Auth     │  │ Buckets  │  │ Files    │  │ Bot/Agent API  │  │
│  │ Cognito  │  │ Explorer │  │ Shares   │  │ Sync, Creds,   │  │
│  │ Google   │  │ RBAC     │  │ Multipart│  │ Heartbeat      │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                                                  │
│  PostgreSQL (Prisma ORM)    AWS S3 (presigned URLs)              │
│  AWS STS (AssumeRole)       AWS Cognito (IdP)                    │
│  AWS EventBridge            AWS SES/SNS                          │
│  Lambda (file-sync)         MaxMind GeoIP                        │
└─────────────────────────────────────────────────────────────────┘
                          ▲  HTTPS / REST
                          │
┌─────────────────────────────────────────────────────────────────┐
│                    electron-app (Desktop Agent)                   │
│              Electron 34 + React 19 (Vite bundled)               │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Auth     │  │ Sync     │  │ Watcher  │  │ Local DB       │  │
│  │ Cognito  │  │ Engine   │  │ chokidar │  │ SQLite (WAL)   │  │
│  │ SSO/Bot  │  │          │  │          │  │ better-sqlite3 │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                                                  │
│  Local Filesystem (ROOT_PATH)    electron-store (encrypted)      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack

### 2.1 Web Application (enterprise-file-management)

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.1.6 |
| UI | React | 19.2.4 |
| Styling | Tailwind CSS | 4.x |
| Component Library | shadcn/ui (Radix primitives) | Latest |
| Charts | Recharts | 2.15.0 |
| ORM | Prisma | 7.4.0 |
| Database | PostgreSQL | — |
| Auth | AWS Cognito (RS256 JWT) | SDK v3 |
| Bot Auth | Ed25519 (node:crypto) + HS256 (jose 6.x) | — |
| File Storage | AWS S3 (presigned URLs, multipart) | SDK v3 |
| Cross-Account | AWS STS AssumeRole | SDK v3 |
| Events | AWS EventBridge | SDK v3 |
| Email/Notifications | AWS SES / SNS | SDK v3 |
| GeoIP | MaxMind | 5.x |
| Forms | react-hook-form + zod | 7.x / 3.x |
| Doc Viewer | @cyntler/react-doc-viewer | 1.17.1 |
| Testing | Vitest + Testing Library + fast-check | 2.x |
| Language | TypeScript (strict) | 5.7.3 |

### 2.2 Desktop Agent (electron-app)

| Layer | Technology | Version |
|---|---|---|
| Runtime | Electron | 34.1.0 |
| UI Framework | React (Vite bundled) | 19.2.4 |
| Bundler | Vite | 7.3.1 |
| Styling | Tailwind CSS | 4.x |
| Local Database | better-sqlite3 (WAL mode) | 11.7.0 |
| Encrypted Store | electron-store | 8.2.0 |
| File Watcher | chokidar | 4.0.3 |
| HTTP Client | axios | 1.13.5 |
| AWS S3 | @aws-sdk/client-s3 + lib-storage | v3 |
| System Info | systeminformation | 5.31.0 |
| Packaging | electron-builder | 26.8.1 |
| Language | JavaScript (CommonJS main, JSX renderer) | — |

---

## 3. Data Model (Prisma Schema)

### 3.1 Server-Side (PostgreSQL via Prisma)

| Model | Key Fields | Purpose |
|---|---|---|
| `Tenant` | id, name, isHubTenant | Multi-tenant root entity |
| `User` | id, email, cognitoSub, role, tenantId, isActive | Human identity. Unique on (email, tenantId) |
| `Bucket` | id, name, region, awsAccountId, tenantId, quotaBytes, versioning, encryption | S3 bucket reference |
| `FileObject` | id, name, key, isFolder, size, mimeType, bucketId, parentId, tenantId, searchVector | Hierarchical file/folder record. GIN index on tsvector |
| `ResourcePolicy` | id, userId, teamId, resourceType, resourceId, actions[] | RBAC policy binding |
| `Team` | id, name, tenantId, allowedIps, isDeleted | User group with IP allowlist |
| `TeamMembership` | userId, teamId | Many-to-many user↔team. Unique on (userId, teamId) |
| `BotIdentity` | id, name, publicKey, userId, tenantId, permissions[], isActive, agentStatus, diagnostics, machineInfo | Machine identity with Ed25519 public key |
| `Share` | id, fileId, tenantId, bucketId, toEmail, expiry, downloadLimit, downloads, passwordHash, status | Secure file share link |
| `AwsAccount` | id, tenantId, awsAccountId, region, roleArn, externalId, status | Cross-account IAM role link (BYOA) |
| `AuditLog` | id, userId, action, resource, details, status, ipAddress, country, region | Compliance audit trail |
| `SyncHistory` | id, status, startedAt, completedAt, totalFiles, syncedFiles, failedFiles | Server-side sync run record |
| `SyncActivity` | id, historyId, action, fileName, status, error | Individual file action within a sync run |
| `MultipartUpload` | id, fileHash, uploadId, bucketId, key, userId | Tracks in-progress S3 multipart uploads |

Key indexes:
- `FileObject`: GIN on searchVector, composite on (bucketId, key), (bucketId, name), tenantId
- `User`: on cognitoSub, email
- `AuditLog`: on action, createdAt, (userId, action)
- `Share`: on fileId, tenantId, bucketId, toEmail, status
- `BotIdentity`: on userId, tenantId

### 3.2 Client-Side (SQLite via better-sqlite3)

Mirrors server models plus local-only tables:

| Table | Purpose |
|---|---|
| `Tenant` | Cached tenant info from server |
| `Account` | Cached AWS account credentials |
| `Bucket` | Cached bucket metadata |
| `FileObject` | Cached file/folder records for offline browsing |
| `SyncConfig` | User-defined sync configurations (interval, direction, watcher flag) |
| `SyncMapping` | Maps local folder ↔ bucket for each SyncConfig |
| `SyncJob` | Execution log for each sync run |
| `LocalSyncActivity` | Per-file action log (UPLOAD, DOWNLOAD, SKIP, DELETE) |
| `SyncState` | Tracks last sync timestamp per config |

SQLite runs in WAL mode for concurrent read/write safety. All data is wiped on logout.

---

## 4. API Surface

### 4.1 Auth APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/login` | POST | Cognito username/password auth |
| `/api/auth/new-password` | POST | Handle NEW_PASSWORD_REQUIRED challenge |
| `/api/auth/google` | GET | Redirect to Cognito Hosted UI (Google SSO) |
| `/api/auth/callback` | GET | Cognito OAuth callback |
| `/api/auth/refresh` | POST | Refresh Cognito tokens |
| `/api/auth/logout` | POST | Clear session cookies |
| `/api/auth/me` | GET | Get current user info |
| `/api/auth/forgot-password` | POST | Initiate Cognito forgot-password flow |
| `/api/auth/confirm-password` | POST | Confirm reset with code + new password |
| `/api/auth/agent-sso` | GET | PKCE SSO initiation for Electron agent |
| `/api/auth/token-exchange` | POST | Exchange PKCE code for tokens |

### 4.2 Bot / Agent APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/bot` | POST | Register a new bot identity |
| `/api/bot/verify` | POST | EdDSA handshake → issue HS256 tokens |
| `/api/bot/refresh` | POST | Refresh bot tokens |
| `/api/heartbeat` | GET | Bot keepalive ping |
| `/api/agent/sync` | GET | Pull full tenant/bucket/file data for agent. Supports `updatedSince` for incremental sync |
| `/api/agent/credentials` | POST | Get temporary AWS STS credentials (1hr TTL) |
| `/api/agent/sync-history` | GET/POST | Read/write sync history |
| `/api/agent/health` | GET/POST | Agent health reporting + diagnostics |

### 4.3 Files & Buckets APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/buckets` | GET/POST | List / create buckets |
| `/api/buckets/[id]` | GET/PATCH/DELETE | Get / update / delete bucket |
| `/api/buckets/[id]/sync` | POST | Trigger S3 re-index for a bucket |
| `/api/files` | GET/POST | List / create files |
| `/api/files/[id]` | GET/PATCH/DELETE | Get / rename / delete file |
| `/api/files/presigned` | GET | Get presigned S3 URL (upload or download) |
| `/api/files/multipart/initiate` | POST | Start multipart upload |
| `/api/files/multipart/sign-part` | POST | Sign a part |
| `/api/files/multipart/complete` | POST | Complete multipart upload |
| `/api/files/multipart/abort` | POST | Abort multipart upload |
| `/api/explorer` | GET | Full-text search across files |
| `/api/file-explorer` | GET | Hierarchical folder browse |

### 4.4 Shares APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/shares` | GET/POST | List / create shares |
| `/api/shares/[shareId]` | GET | Get share details |
| `/api/shares/[shareId]/auth` | POST | Authenticate password-protected share |
| `/api/shares/[shareId]/download` | GET | Download shared file |

### 4.5 Admin APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/users` | GET/POST | List / invite users |
| `/api/accounts` | GET/POST | List / create AWS accounts |
| `/api/aws-accounts` | GET/POST | List / create cross-account IAM links |
| `/api/aws-accounts/[id]` | GET/PATCH/DELETE | Manage individual AWS account |
| `/api/policies` | GET/POST | List / create RBAC policies |
| `/api/teammates` | GET/POST | Manage team memberships |
| `/api/tenant/teams` | GET/POST | Tenant-scoped team management |
| `/api/superadmin/tenants` | GET | Superadmin: list all tenants |
| `/api/superadmin/users` | GET | Superadmin: list all users |

---

## 5. IPC Communication (Electron)

The desktop agent uses Electron IPC for main↔renderer communication:

| Channel | Direction | Purpose |
|---|---|---|
| `get-root-path` | Renderer→Main | Get configured root sync path |
| `list-path-content` | Renderer→Main | List local folder contents |
| `create-folder` | Renderer→Main | Create local directory |
| `open-file` | Renderer→Main | Open file with system default app |
| `select-file` | Renderer→Main | Open file picker dialog |
| `select-folder-upload` | Renderer→Main | Open folder picker dialog |
| `upload-items` | Renderer→Main | Upload files/folders to S3 |
| `download-file` | Renderer→Main | Download from URL to local path |
| `download-s3-file` | Renderer→Main | Download from S3 via bucket ID + key |
| `get-active-transfers` | Renderer→Main | Get current transfer queue status |
| `pause-transfer` | Renderer→Main | Pause a transfer |
| `resume-transfer` | Renderer→Main | Resume a paused transfer |
| `terminate-transfer` | Renderer→Main | Cancel a transfer |
| `db-query` | Renderer→Main | Execute SQL against local SQLite |
| `init-sync` | Renderer→Main | Start sync engine with auth token |
| `stop-sync` | Renderer→Main | Stop sync engine |
| `force-sync` | Renderer→Main | Trigger immediate sync cycle |
| `sync-buckets-now` | Renderer→Main | Awaitable initial bucket sync |
| `sync-config-now` | Renderer→Main | Trigger sync for specific config |
| `search-files` | Renderer→Main | Full-text search across local files |
| `get-local-sync-activities` | Renderer→Main | Read local sync activity log |
| `get-sync-configs` | Renderer→Main | List all sync configurations |
| `create-sync-config` | Renderer→Main | Create new sync config + mappings |
| `update-sync-config` | Renderer→Main | Update existing sync config |
| `delete-sync-config` | Renderer→Main | Delete sync config |
| `select-sync-folder` | Renderer→Main | Open folder picker for sync mapping |
| `auth:login` | Renderer→Main | Cognito email/password login |
| `auth:new-password` | Renderer→Main | Handle NEW_PASSWORD_REQUIRED |
| `auth:refresh` | Renderer→Main | Refresh tokens |
| `auth:logout` | Renderer→Main | Logout + wipe local data |
| `auth:get-session` | Renderer→Main | Get current auth session |
| `auth:forgot-password` | Renderer→Main | Initiate password reset |
| `auth:confirm-password` | Renderer→Main | Confirm password reset |
| `auth:open-browser-sso` | Renderer→Main | Start PKCE SSO flow |
| `bot:generate-keypair` | Renderer→Main | Generate Ed25519 key pair |
| `bot:get-public-key` | Renderer→Main | Get stored public key |
| `bot:save-bot-id` | Renderer→Main | Store bot ID |
| `bot:handshake` | Renderer→Main | Perform bot handshake |
| `bot:attempt-auto-login` | Renderer→Main | Auto-login on startup |
| `bot:deregister` | Renderer→Main | Clear bot identity + logout |
| `doctor:run-diagnostics` | Renderer→Main | Run all diagnostic checks |
| `doctor:run-single` | Renderer→Main | Run single diagnostic |
| `doctor:get-heartbeat-history` | Renderer→Main | Get heartbeat history |
| `transfer-status-update` | Main→Renderer | Broadcast transfer progress |
| `network-stats` | Main→Renderer | Broadcast network rx/tx stats |
| `disk-stats` | Main→Renderer | Broadcast disk usage stats |
| `auth-expired` | Main→Renderer | Notify renderer of expired auth |
| `sso-auth-result` | Main→Renderer | Deliver SSO tokens to renderer |

---

## 6. Security Architecture

### 6.1 Human User Security
- Cognito RS256 JWT verified on every API call via `verifyToken()`
- Session cookies (HTTP-only) for web app
- RBAC via `ResourcePolicy` table — actions checked with `checkPermission(user, action, resourceId)`
- IP allowlist per team — enforced at login and middleware level
- `withTenantAccess` middleware enforces tenant isolation on all API routes
- PLATFORM_ADMIN bypasses tenant isolation checks

### 6.2 Bot Identity Security
- Ed25519 asymmetric key pair — private key never leaves the agent machine
- Private key encrypted at rest using machine-specific key (SHA-256 of hostname + username)
- Server stores only the public key (in `BotIdentity.publicKey`)
- HS256 app-level JWT issued after successful EdDSA signature verification
- Access token TTL: 15 minutes; Refresh token TTL: 7 days
- Permissions are bucket-scoped: `BUCKET:<id>:<ACTION>` (READ, WRITE, DELETE, SHARE, DOWNLOAD)
- Bot can be revoked instantly by setting `isActive = false`

### 6.3 File Sharing Security
- Share links are CUIDs (not guessable)
- Optional bcrypt password protection (`passwordHash` stored, never plaintext)
- Expiry date enforced server-side
- Download count enforced server-side (downloads vs downloadLimit)
- Status tracking: ACTIVE → EXPIRED / REVOKED

### 6.4 AWS Credential Security
- Cross-account access via STS AssumeRole (roleArn + externalId)
- Temporary credentials with 1-hour TTL
- AWS account credentials encrypted at rest in database (via `lib/encryption`)
- Agent receives scoped STS credentials, never raw account keys

### 6.5 Deep Link Protocol
- Custom protocol: `cloudvault://auth?token=<idToken>&refresh=<refreshToken>`
- Used for SSO callback on macOS (open-url event)
- Single instance lock prevents duplicate app instances

---

## 7. Sync Engine Architecture

### 7.1 Sync Flow
```
1. Login → init SyncManager with auth token
2. Immediate syncAll() → GET /api/agent/sync → upsert to local SQLite
3. Every 1 min: check SyncConfigs for configs due to run
4. Per config:
   a. DOWNLOAD: remote files → check local → download missing via presigned URL
   b. UPLOAD: local files → check remote → queue uploads
5. File watcher (chokidar) handles real-time uploads for UPLOAD configs
6. downloadingPaths Set prevents re-upload loop
7. Activities logged to LocalSyncActivity (local) + SyncHistory (server)
8. Heartbeat pings /api/heartbeat periodically
9. Token refresh 5 min before expiry
```

### 7.2 Incremental Sync
- `GET /api/agent/sync?updatedSince=<ISO timestamp>` returns only files modified after the given time
- First sync omits this param for a full sync
- Subsequent syncs pass the last sync timestamp

### 7.3 Conflict Resolution
- Size + ETag comparison for download decisions
- Size + mtime comparison for upload decisions
- No merge conflict resolution — last write wins

---

## 8. Lambda Functions

### 8.1 file-sync Lambda (`lambda/file-sync/index.ts`)
- Triggered by SQS events (from S3 event notifications via EventBridge)
- Parses S3 events (ObjectCreated, ObjectRemoved)
- Resolves bucket → tenant mapping
- For creates: upserts FileObject records with parent directory chain
- For deletes: removes FileObject records
- Supports cross-account S3 access via BYOA AwsAccount credentials
- Writes audit logs for each file operation
- Returns SQS batch response for partial failure handling

---

## 9. Deployment & Packaging

### 9.1 Web Application
- Multi-stage Docker build (node:20-slim)
  - Stage 1 (deps): Install npm dependencies
  - Stage 2 (builder): Generate Prisma client, build Next.js
  - Stage 3 (runner): Standalone output, runs as non-root user (nextjs:nodejs)
- Output: `next start` standalone mode on port 3000
- Next.js output tracing for minimal image size

### 9.2 Desktop Agent
- electron-builder for cross-platform packaging
- Targets:
  - Windows: NSIS installer (x64)
  - macOS: DMG (x64 + arm64), hardened runtime
  - Linux: AppImage + deb (x64)
- ASAR packaging with unpack for native modules (better-sqlite3, systeminformation)
- Custom protocol registration: `cloudvault://`
- Build scripts: `build:win`, `build:mac`, `build:linux`
- Dev mode: `concurrently` runs Vite + Electron together

### 9.3 Environment Variables

**Web App (enterprise-file-management/.env):**
- `DATABASE_URL` — PostgreSQL connection string
- `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION` — AWS Cognito config
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — Default AWS credentials
- `ENCRYPTION_KEY` — For encrypting stored AWS account credentials
- `BOT_JWT_SECRET` — HS256 secret for bot token signing
- `NEXTAUTH_SECRET` — Session encryption
- `MAXMIND_LICENSE_KEY` — GeoIP database

**Desktop Agent (electron-app/.env):**
- `ENTERPRISE_URL` — Web app base URL
- `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION` — AWS Cognito config
- `ROOT_PATH` — Local sync root directory
- `ENCRYPTION_KEY` — For electron-store encryption

---

## 10. End-to-End Workflow: Agent Sync

```
1. Admin registers bot in web app
   → BotIdentity created with public key + bucket permissions

2. Admin pastes botId into Electron app

3. Electron performs handshake
   → Signs JWT with Ed25519 private key
   → POST /api/bot/verify
   → Receives HS256 accessToken (15 min) + refreshToken (7 days)

4. Electron calls GET /api/agent/sync
   → Server returns tenants, accounts (with encrypted AWS creds), buckets, file lists
   → Scoped to bot's allowed buckets

5. Electron upserts data into local SQLite DB

6. SyncManager runs per-config sync:
   DOWNLOAD: for each file in DB → check local → download missing via presigned URL
   UPLOAD:   for each local file → check DB → upload new/modified via presigned URL

7. File watcher (chokidar) handles real-time uploads for UPLOAD configs

8. Sync activities logged to LocalSyncActivity (local) and SyncHistory (server)

9. Heartbeat pings /api/heartbeat every N seconds

10. Token refresh happens automatically 5 min before expiry

11. Health reporter pushes diagnostics + machine info to /api/agent/health
```

---

## 11. Known Technical Debt

1. **Bot permission enforcement gap** — Only `/api/agent/sync` and `/api/heartbeat` enforce bucket-scoped permissions. 10+ routes lack bot permission checks. Full audit in `BOT-PERMISSION-AUDIT.md`.
2. **Deprecated crypto APIs** — `bot-auth.js` uses `crypto.createCipher`/`createDecipher` (deprecated). Should migrate to `createCipheriv`/`createDecipheriv`.
3. **No Next.js middleware** — No `middleware.ts` file exists; auth/tenant checks are done per-route rather than centrally.
4. **Sync history not scoped** — `SyncHistory` records lack bot/user attribution.
5. **No automated tests for Electron app** — `test` script is a no-op placeholder.
6. **Single-region deployment** — No multi-region or CDN configuration documented.
