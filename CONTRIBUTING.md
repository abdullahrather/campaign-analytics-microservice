# Contributing

Thanks for your interest. Bug reports, ideas and pull requests are all welcome.

## Getting started

You need Node.js 22 or newer.

```bash
npm install
npm run dev
```

See the [README](./README.md) for the demo logins.

## Before you open a pull request

Run these checks, which CI also runs:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run typecheck --prefix web
```

`npm test` runs against a real PostgreSQL that starts automatically, separate from your development data.

## Guidelines

- Keep each pull request to one change, and explain why it's needed.
- Add or update tests when behaviour changes.
- If you change the database, add a migration with `npx prisma migrate dev`.
- If you add or change a route, update `src/modules/docs/openapi.ts`. A test fails when a route is missing from the docs.
- Use only fictional brands and data in examples, seeds and tests.

## Releases

Merging a pull request creates a version automatically. It's a patch by default. Add the label `release:minor` for a new feature, `release:major` for a breaking change, or `skip-release` for no release.

## Reporting a security problem

Please don't open a public issue. Use GitHub's private vulnerability reporting on the repository's **Security** tab.
