# Roadmap

The goal is to grow this from a working demo into a complete ad platform for streaming services: advertisers run campaigns, a real player shows real ads, high traffic is handled reliably, and AI helps people make better decisions.

Each phase ends with something you can use and show. Phases are built in order, and each one ships as its own pull requests.

## Done

- [x] Campaigns with budgets, CPM, dates, goals and targeting
- [x] Ad decisions, batched event tracking and hourly rollups
- [x] Live dashboard, traffic simulator and demo data
- [x] Advertiser and admin roles
- [x] One-command local setup, integration tests and CI

## Phase 1: Public showcase

Make the project easy to find, understand and try.

- [x] Add screenshots and a short demo GIF to the README
- [x] Publish interactive API docs from an OpenAPI spec
- [x] Add a license, contribution guide and changelog
- [x] Add automatic version tags and releases
- [ ] Deploy a public demo with a read-only guest login and clearly marked fictional data

**Done when:** a stranger can open a link and explore the product in under a minute.

## Phase 2: Accounts and teams

Replace demo logins with real multi-user accounts.

- [ ] Sign-up, email verification and password reset
- [ ] Organisations with members, invitations and roles (owner, manager, analyst)
- [ ] Session refresh and sign-out from all devices
- [ ] Two-factor authentication
- [ ] Audit log of who changed what
- [ ] Admin console for users, organisations and campaigns

**Done when:** two companies can use the platform side by side and never see each other's data.

## Phase 3: Real ad playback

Move from simulated numbers to ads actually playing.

- [ ] Upload ad creatives, with size and format checks
- [ ] Transcode video and store it behind a CDN
- [ ] Review queue so an admin approves creatives before they run
- [ ] Demo streaming site with a video player and pre-, mid- and post-roll ads
- [ ] Player SDK that reports impressions, quartiles, clicks and completions
- [ ] VAST support, the ad industry's standard format for players

**Done when:** you can upload an ad, press play on a demo show, and see that view on the dashboard.

## Phase 4: Reliable, high-volume delivery

Handle traffic at the level of a real streaming service.

- [ ] Event IDs, so a replayed batch is never counted twice
- [ ] Queue between tracking and storage (Redis and BullMQ, then Kafka if needed)
- [ ] Cached ad decisions, with live delivery counters in Redis
- [ ] Hard budget stops that hold under concurrent traffic
- [ ] Short-lived signed API keys for players
- [ ] Bot and invalid traffic filtering
- [ ] Load tests with k6, with published results

**Done when:** a load test sustains 10,000 events per second with no lost or double-counted events.

## Phase 5: Smarter campaigns

Give advertisers the controls they expect from a commercial ad platform.

- [ ] Frequency caps, so one viewer doesn't see an ad too often
- [ ] Dayparting, so ads run at chosen hours
- [ ] Daily budgets and even, ASAP or custom pacing
- [ ] Audience segments built from viewing interests, with consent
- [ ] Competitive separation, so rival brands don't run in the same break
- [ ] Creative rotation and A/B tests
- [ ] Reach and delivery forecast before a campaign launches
- [ ] Auction mode as an option alongside guaranteed delivery

**Done when:** an advertiser can see the expected reach of a campaign before launch and get close to it.

## Phase 6: Deeper analytics and reporting

Answer business questions, not just show totals.

- [ ] Reach and average frequency
- [ ] Viewer drop-off by quartile
- [ ] Campaign comparison and period-over-period change
- [ ] Custom report builder with CSV and PDF export
- [ ] Scheduled reports by email
- [ ] Alerts for under-delivery, budget burn and sudden drops
- [ ] Analytics database (ClickHouse) if PostgreSQL reaches its limits

**Done when:** an advertiser gets a weekly report and an alert without opening the dashboard.

## Phase 7: AI assistant

Use Claude to turn data into decisions.

- [ ] Ask questions in plain language and get answers from your campaign data
- [ ] Automatic weekly summary of what changed and why
- [ ] Recommendations for budget, targeting and pacing, always approved by a person
- [ ] Campaign setup from a written brief
- [ ] Anomaly explanations in alerts
- [ ] Content checks on creatives before human review

**Done when:** someone can ask "why is this campaign behind?" and get a correct answer based on their own data.

## Phase 8: Billing

Turn delivery into invoices.

- [ ] Prepaid balances and invoicing from delivered impressions
- [ ] Stripe payments in test mode
- [ ] Publisher revenue reports
- [ ] Multi-currency and EU VAT
- [ ] Plans and usage limits

**Done when:** a finished campaign produces a correct invoice with no manual steps.

## Phase 9: Production readiness

Bring everything up to the standard of a live service.

- [ ] Structured logs, metrics and tracing (OpenTelemetry and Grafana)
- [ ] Database backups with tested restores
- [ ] Staging environment and zero-downtime deployments
- [ ] Kubernetes or managed container deployment
- [ ] GDPR tools: viewer consent, data export, deletion and retention limits
- [ ] End-to-end browser tests and security scanning in CI
- [ ] Dashboard in English and German

**Done when:** the platform can be restored from backup, and a failure raises an alert before a customer notices.
