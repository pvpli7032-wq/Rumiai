# Project architecture rules

Khui AI is maintained as a set of business modules. Keep this structure across the whole project, not only in the feature currently being changed.

- Group HTTP entrypoints under `src/app/api/<domain>/`. A route should validate transport input, resolve authentication, call the domain service, and map the result to an HTTP response. Keep pricing, state transitions, ledger writes, and provider protocol details out of route handlers.
- Put server-side business rules in a named domain module under `src/lib/<domain>/`. A module owns its rules and persistence transaction; other domains call its exported service functions instead of copying the rules or reaching into private internals.
- Keep page composition under `src/app/`; put reusable and domain-specific presentation under `src/components/`. UI code must not write directly to the database or decide authoritative balances, prices, permissions, or payment status.
- Keep Prisma models in `prisma/schema.prisma` and schema changes in a new ordered migration. Preserve existing data and test migrations against a separate database.
- Keep cross-cutting infrastructure (authentication, database client, logging, localization) explicit and small. Avoid creating generic frameworks for one caller.
- When touching a legacy module, improve the boundary for that workflow and add focused tests. Do not launch a whole-project rewrite or move unrelated modules without a reviewed map, migration plan, and user-approved scope.
- Payment tests must use generated local keys, a local mock provider, and an isolated database. Never run a charge or put payment credentials in source, logs, test fixtures, or chat.

Before a substantial change, map the affected domain, its callers, persistence, and tests. Keep file responsibilities clear enough that a maintainer can locate a rule without tracing unrelated features.
