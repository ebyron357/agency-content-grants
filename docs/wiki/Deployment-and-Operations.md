# Deployment and Operations

Production has not been provisioned. The owner action is to create the Render environment from render.yaml, approve paid resources, and configure owner-held secrets.

After provisioning, verify /api/healthz, /api/readyz, running commit parity, login/session security, database persistence, durable storage, exports, uploads, and rollback/recovery behavior.
