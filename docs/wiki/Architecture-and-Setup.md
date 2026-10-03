# Architecture and Setup

The product is a pnpm workspace using TypeScript/Node 24. The shipped frontend is React/Vite/Tailwind/Radix/TipTap, the API is Express 5, persistence is PostgreSQL 16 with Drizzle migrations, and the deployment target is Render with a managed database and persistent disk.

The product includes scoped API keys, signed webhooks, export pipelines, provider-backed AI, simulated/real distribution adapters, and readiness/health endpoints.
