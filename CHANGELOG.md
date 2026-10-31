# Changelog

The main changes in each version. Every release's full notes are on the [Releases page](https://github.com/abdullahrather/campaign-analytics-microservice/releases).

## Unreleased

### Added

- Interactive API docs at `/docs`, generated from the validation schemas
- Read-only guest login and a public demo mode
- Demo traffic that runs inside the app, and only while someone is viewing it in demo mode
- Automatic version tags and GitHub Releases
- MIT license, contribution guide and this changelog
- Screenshots and a demo GIF in the README

### Changed

- The dashboard is now served with the same security headers as the API
- `npm run simulate` is replaced by the built-in demo traffic

## 1.0.0

### Added

- Campaigns with budgets, CPM, dates, goals and targeting
- Ad decisions and batched event tracking with hourly rollups
- Campaign management, analytics, pacing and breakdowns
- Live React dashboard with light and dark themes
- One-command local setup with PostgreSQL included
- Integration tests and CI for the API, dashboard and Docker
