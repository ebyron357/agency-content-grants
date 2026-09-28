# Universal Project Completion Standard

> **Non-negotiable:** A project is not complete because the code works. It is complete only when an authorized person can access it, understand it, operate it, administer it, support it, recover it, secure it, transfer it, and shut it down safely without guessing.

## 1. Hard Blocker Rule

A project may remain open only when a failure prevents one or more of:

- safe production access
- core application operation
- authentication or required authorization
- required data persistence
- tenant/workspace isolation where applicable
- required client onboarding
- administration
- security
- data integrity
- required backup/recovery
- responsible client handoff

The following are non-blocking unless explicitly required for operation:

- redesigns
- aesthetic polish
- speculative enhancements
- experimental features
- optional integrations
- future automation
- research
- nonessential modernization

## 2. Production Identity and Access

Every project must document:

- project name and business purpose
- repository and default branch
- production URL
- login URL
- current production version/SHA
- hosting provider
- database provider
- domain/DNS provider
- account-creation process
- admin access process
- client/user access process
- username/email convention
- temporary credential process
- secure credential-delivery process
- first-login password rotation
- password requirements
- password-recovery process
- MFA process where supported
- logout process
- account-lockout recovery
- invitation process
- workspace/tenant selection
- disabled-user behavior

Never commit real passwords, API keys, tokens, or secret values.

## 3. Client Provisioning

Document exactly how to:

- create a new client/workspace
- assign the first administrator
- issue and deliver credentials securely
- verify first login
- invite additional users
- assign and change roles
- disable/remove users
- transfer administrative ownership
- suspend/reactivate a client
- close a client account

## 4. User Documentation

Provide a complete client/user manual covering all real user-facing functionality, including:

- account creation
- login/logout
- password recovery
- navigation
- dashboard
- every user-facing module
- search
- records
- forms
- workflows
- tasks
- notifications
- approvals
- integrations
- uploads/downloads
- team collaboration
- profile/settings
- common errors
- support
- accessibility controls where present
- offboarding/account closure

Do not document features that do not exist.

## 5. Administrator / Operator Documentation

Provide an administrator/operator manual covering:

- architecture
- hosting
- database
- storage
- authentication
- domains/DNS
- SSL/TLS
- environment variables by name
- secret storage
- admin provisioning
- tenant/workspace management
- role management
- email configuration
- APIs
- webhooks
- scheduled jobs
- queues/workers
- logs
- monitoring
- integrations
- deployment
- rollback
- backup
- restore
- data export
- data deletion
- incidents
- client/user offboarding

## 6. Environment Map

Identify all applicable environments:

- local/development
- test
- preview/staging
- production

For each, record:

- URL
- branch
- hosting target
- database
- storage
- secrets source
- deployment method
- who has access

## 7. Roles and Permissions

Maintain a roles/permissions matrix for applicable roles such as:

- owner
- super admin
- admin
- manager
- member
- client
- read-only user
- service account
- agent/automation

Document who may:

- view
- create
- edit
- delete
- export
- invite
- approve
- configure
- administer
- access billing
- access production

## 8. Security Baseline

Document and verify:

- authentication method
- password requirements
- MFA where supported
- session behavior
- tenant isolation
- least privilege
- invitation security
- API authentication
- webhook validation
- secrets handling
- credential rotation
- service accounts
- audit logging
- account disabling
- incident reporting
- dependency vulnerability scanning
- secret scanning

## 9. Secrets and Credential Register

Record metadata only:

- secret name
- purpose
- provider
- environment
- owner
- storage location
- rotation process
- expiration if applicable

Never record secret values.

## 10. Ownership Register

Identify ownership for:

- repository
- hosting
- database
- domain
- DNS
- SSL certificates
- storage
- authentication provider
- email provider
- SMS provider
- payment provider
- AI providers
- analytics
- monitoring
- error tracking
- CDN
- external APIs
- SaaS integrations
- design files/assets
- client data

## 11. Billing and Cost Controls

Document:

- provider/service
- plan
- billing owner
- renewal date
- expected cost
- usage limits
- overage behavior
- cancellation process
- budget owner
- spending alerts
- API quotas
- token/model limits where applicable
- storage limits
- escalation for unexpected spend

## 12. Integration Truth

Every integration must have one status:

- LIVE + VERIFIED
- CONFIGURATION REQUIRED
- AVAILABLE BUT NOT CERTIFIED
- DEGRADED
- NOT IMPLEMENTED
- DEFERRED
- DEPRECATED

For each integration, record:

- purpose
- provider
- owner
- authentication method
- required credentials
- failure impact
- recovery procedure

Code existing does not mean an integration is operational.

## 13. Dependency and Architecture Map

Maintain an inventory of major:

- frontend/backend components
- frameworks
- runtime versions
- libraries
- databases
- storage
- APIs
- queues/workers
- scheduled jobs
- webhooks
- SaaS providers
- plugins
- models
- SDKs
- external data/services

Document the failure impact of critical dependencies.

## 14. API and Integration Contracts

Where applicable document:

- endpoint
- purpose
- authentication
- request/response format
- error behavior
- retry behavior
- idempotency
- rate limits
- timeout behavior
- versioning
- deprecation rules

## 15. Deployment Runbook

Document:

- repository
- production branch
- build command
- start command
- deployment trigger
- deployment platform
- environment variables by name
- migration process
- health endpoint
- deployed SHA/version verification
- production verification
- smoke tests
- rollback process

## 16. Release and Change Control

For each production release record:

- release version/SHA
- deployment date
- who deployed it
- changes
- tests performed
- migration impact
- rollback point
- release notes/changelog

Avoid undocumented direct production changes.

## 17. Testing Standard

Use applicable:

- unit tests
- integration tests
- end-to-end tests
- production-safe smoke tests
- authentication tests
- authorization tests
- tenant-isolation tests
- regression tests
- security checks
- accessibility checks
- backup verification
- restore verification
- rollback verification

Closeout controls should have binary PASS/FAIL outcomes.

## 18. Performance and Capacity

Where applicable document:

- expected response time
- expected concurrent users
- practical record volume
- storage/file limits
- API limits
- queue/worker capacity
- scaling expectations

## 19. Monitoring, Alerts, and Logs

Document:

- uptime monitoring
- health endpoints
- application errors
- database health
- queue/job health
- scheduler health
- integration failures
- authentication failures
- email failures
- storage failures
- resource exhaustion
- alert severity
- alert recipient
- escalation owner
- log location
- log retention
- who may access logs

An alert without an owner is not an operational control.

## 20. Auditability

Where applicable preserve an audit trail for:

- logins
- administrative actions
- role changes
- approvals
- data exports
- data deletion
- credential changes
- important configuration changes
- automated/agent actions

## 21. Incident Response

Define:

- severity levels
- incident owner
- escalation path
- emergency contacts
- risky-feature shutdown procedure
- rollback procedure
- client communication
- evidence preservation
- post-incident documentation

## 22. Backup and Restore

Document:

- what is backed up
- backup frequency
- retention
- storage location
- encryption
- backup owner
- restore procedure
- restore authorization
- restore destination
- verification procedure
- expected recovery window

A backup without a viable restore procedure is incomplete.

## 23. Disaster Recovery and Business Continuity

Document expected actions for failures involving:

- hosting
- database
- storage
- domain
- DNS
- authentication
- email
- payment provider
- AI provider
- critical third-party services
- key employee/operator unavailability
- vendor shutdown

Record RTO/RPO where appropriate.

## 24. Data Classification and Lifecycle

Where applicable classify data such as:

- public
- internal
- confidential
- sensitive
- regulated

Document:

- what data is collected
- why it is collected
- where it is stored
- who may access it
- whether external/AI providers may receive it
- masking/redaction rules
- retention
- export
- archival
- deletion
- backup implications
- restore implications
- client/user termination

## 25. Data Export, Portability, and Offboarding

Document:

- exportable data
- available formats
- export authorization
- export process
- exclusions
- final termination export
- user removal
- administrator removal
- ownership transfer
- client suspension
- client termination
- credential revocation
- integration disconnect
- data deletion
- backup retention
- subscription cancellation
- final closure confirmation

## 26. Privacy and Compliance

Where applicable document:

- privacy responsibilities
- consent
- processors/subprocessors
- sensitive-data handling
- retention
- deletion
- access requests
- contractual/regulatory requirements

Do not claim legal compliance unless actually verified.

## 27. Accessibility and Compatibility

Document and verify as applicable:

- supported browsers
- desktop behavior
- mobile behavior
- tablet behavior
- keyboard navigation
- visible focus
- screen-reader considerations
- reduced motion
- responsive behavior
- known limitations

## 28. Email and Notification Reliability

Where applicable verify:

- sending provider
- sending domain
- SPF
- DKIM
- DMARC where applicable
- bounce/failure handling
- invitation delivery
- password-reset delivery
- critical notification delivery

## 29. Support and Troubleshooting

Document:

- support channel
- support owner
- hours if applicable
- escalation path
- bug-report procedure
- emergency path

Troubleshooting should cover applicable cases such as:

- login failure
- password-reset failure
- expired/wrong invitation
- wrong workspace
- permission denied
- missing data
- save/persistence failure
- disconnected integration
- API/database/email failure
- scheduler/job failure
- webhook failure
- deployment failure
- browser/mobile problem

For each include:

- symptom
- likely cause
- user action
- admin action
- escalation point

## 30. Training and Knowledge Transfer

Provide as applicable:

- user onboarding
- administrator onboarding
- first-day checklist
- critical workflow walkthrough
- quick reference
- screenshots/recorded training where useful

Documentation is not complete merely because it exists. An authorized person who did not build the system must be able to use it.

## 31. Source Code, IP, Assets, and Vendors

Document:

- repository owner/access
- third-party licenses
- proprietary assets
- client-owned assets
- media/font licensing
- design files
- templates
- schemas
- critical configuration files
- important external vendors
- vendor account owner
- vendor support path
- subscription/contract
- renewal/exit process
- failure impact

## 32. Domain, DNS, and Certificate Register

Document:

- registrar
- owner
- expiration
- renewal status
- nameservers
- DNS host
- critical DNS records
- SSL provider
- renewal method
- recovery access

## 33. Software Supply Chain

Document or verify as applicable:

- supported runtime versions
- dependency inventory
- vulnerability scan
- license scan
- deprecated dependencies
- end-of-life dependencies
- secret scanning
- branch protections

## 34. AI Agent and Automation Controls

For agents/automations document:

- purpose
- trigger
- permissions
- allowed actions
- systems it may modify
- approval requirements
- human checkpoints
- retry logic
- duplicate-action protection
- failure behavior
- kill switch
- escalation path
- audit trail

## 35. Known Limitations

Explicitly record:

- unsupported workflows
- disabled capabilities
- uncertified integrations
- manual processes
- technical constraints
- capacity limitations
- browser/device limitations
- known operational risks

Clients must not discover important limitations by accident.

## 36. Production Acceptance Test

Before closeout verify:

- approved release is deployed
- production URL works
- health checks pass
- database works
- authentication works
- authorization works
- tenant isolation works where applicable
- primary workflow works
- persistence works
- required notifications work
- integrations marked LIVE actually work
- synthetic/test data is removed

## 37. Client Acceptance

Record:

- client/admin account provisioned
- first login completed
- correct workspace confirmed
- documentation delivered
- training delivered if required
- known limitations disclosed
- credential handoff completed
- acceptance acknowledged

## 38. Ownership Transfer

Where applicable confirm transfer of:

- repository access
- hosting
- database
- domain
- DNS
- billing
- analytics
- email
- API accounts
- integrations
- design assets
- documentation

## 39. Decommissioning Plan

Document how to safely:

- export final data
- notify users/client
- disable logins
- stop scheduled jobs
- revoke credentials
- disconnect integrations
- preserve required records
- delete data where required
- cancel subscriptions
- transfer/release domain
- archive repository
- confirm shutdown

## 40. Required Repo Handoff Files

Each applicable production repository should contain or link to:

- `docs/PROJECT_COMPLETION_STANDARD.md`
- `docs/PROJECT_CLOSEOUT_STATUS.md`
- `docs/CLIENT_USER_MANUAL.md`
- `docs/ADMIN_OPERATIONS_MANUAL.md`
- `docs/SECURITY_AND_ACCESS_HANDOFF.md`
- `docs/DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`
- `docs/DATA_LIFECYCLE_AND_OFFBOARDING.md`
- `docs/TROUBLESHOOTING_AND_SUPPORT.md`
- `docs/CLIENT_ACCESS_HANDOFF_TEMPLATE.md`
- `docs/FINAL_CLIENT_ACCEPTANCE.md`

If a document does not apply, mark it **NOT APPLICABLE** with a short reason in the closeout status rather than silently omitting it.

## 41. Project Closeout Status

`docs/PROJECT_CLOSEOUT_STATUS.md` must classify each applicable requirement as:

- PASS
- FAIL
- BLOCKED
- NOT APPLICABLE
- NON-BLOCKING FOLLOW-UP

Every PASS should include evidence where available.

## 42. Final Evidence Package

Final evidence must include as applicable:

- production URL
- login URL
- deployed SHA/version
- deployment status
- health result
- test results
- client login verification
- admin access verification
- core workflow verification
- security/tenant-isolation evidence
- backup status
- restore procedure
- integration statuses
- documentation
- known limitations
- ownership/billing records

## 43. Agent Rule

Any agent working in this repository must:

1. read this standard before declaring work complete;
2. use current code and production state, not stale documentation;
3. avoid reopening completed work;
4. resolve agent-doable blockers;
5. stop only at genuine owner-controlled or external boundaries;
6. provide exact evidence;
7. never let optional enhancements delay closeout.

## 44. Closure States

Use explicit closure states:

- READY FOR CLIENT HANDOFF
- READY FOR INTERNAL OPERATION
- BLOCKED — OWNER ACTION REQUIRED
- BLOCKED — TECHNICAL OPERATING FAILURE

Do not use vague statuses such as "almost done", "basically ready", or "needs polish".

## 45. Final Test

A project is not operationally complete if an authorized person still has to guess:

- where to log in
- how to create an account
- what account/credentials to use
- how to reset access
- how to add a user
- what role a user has
- who owns the system
- who pays for the system
- how to deploy
- how to roll back
- how to restore data
- where the database lives
- how integrations are configured
- what happens when a dependency fails
- how to get data out
- how to delete data
- how to offboard a user/client
- how to obtain support
- how to shut the system down safely

If any of those require guessing, the operational handoff is incomplete.
