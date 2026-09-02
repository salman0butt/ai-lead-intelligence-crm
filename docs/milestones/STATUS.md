# Milestone Status

This ledger tracks the ordered implementation roadmap for AI Lead Intelligence CRM.

| Milestone | Name | Status |
| --- | --- | --- |
| M0 | Foundation | Complete |
| M1 | Durable PostgreSQL Job System | Complete |
| M2 | Campaign Management | Complete |
| M3 | Search Planner | Complete |
| M4 | Browser Business Discovery | Complete |
| M5 | Deduplication Engine | Complete |
| M6 | Domain Resolution & Website Verification | Next |
| M7 | Website Crawler | Remaining |
| M8 | Contact Enrichment | Remaining |
| M9 | Website Technology & Audit Engine | Remaining |
| M10 | OpenAI Provider Foundation | Remaining |
| M11 | LangGraph Research Engine | Remaining |
| M12 | Evidence-First Research | Remaining |
| M13 | Opportunity Engine | Remaining |
| M14 | AI Voice Agent Opportunity Detection | Remaining |
| M15 | Lead Scoring | Remaining |
| M16 | Discovery Results & Filtering | Remaining |
| M17 | CRM | Remaining |
| M18 | Personalized Outreach | Remaining |
| M19 | Quick vs Deep Research | Remaining |
| M20 | Autonomous Campaign Rules | Remaining |
| M21 | Natural Language AI CRM Copilot | Remaining |
| M22 | Production Hardening | Remaining |
| M23 | Performance & Scale Validation | Remaining |
| M24 | Future Features | Remaining |

## Milestone 5 completion

M5 delivers workspace-scoped canonical `Business` persistence above M4 candidates, conservative deterministic normalization, layered provider/domain/phone/secondary exact matching, cautious geography-supported fuzzy matching, ambiguity-safe decisions, strong-identifier conflict vetoes for weaker rules, candidate `matchedBusinessId`/confidence/reason audit fields, replay idempotency, and PostgreSQL transaction-scoped workspace advisory locking.

The M4 discovery transaction now canonicalizes every newly persisted candidate atomically with provenance, task cursor/counters, and provider result accounting. A local bounded backfill command canonicalizes pre-M5 candidates with the same lock and matching engine and is restart-safe/idempotent.

M5 intentionally does not discover or verify official domains, visit websites, crawl pages, enrich contacts, run website audits, perform AI research, score leads, or add CRM/outreach behavior. Official domain resolution and verification begins in M6.

M5 implementation and regression verification passed the complete PR CI gate, including clean Prisma migration application, all package/unit/integration/browser/queue tests, typecheck, lint, build, and compiled application smoke tests. PR #7 is the final milestone integration PR; it replaces draft PR #6 only because the connector's draft-to-ready mutation failed. After merge, the merge-triggered `main` CI is the final repository-level confirmation.

## Milestone 4 completion

M4 delivers real browser-based public business discovery behind a provider-neutral package, normalized candidates and source provenance, provider usage accounting, durable cursor/page continuation, crash-safe next-page scheduling repair, stale-generation protection for pause/resume/cancel, bounded browser concurrency, deterministic real-Chromium fixture tests, and an optional fail-closed AI page classifier.

M4 intentionally does not include canonical cross-source deduplication, domain resolution, crawling, enrichment, website audits, AI research, lead scoring, CRM/outreach, or autonomous campaign behavior. Canonical deduplication is now delivered by M5; the remaining capabilities continue in M6+ in the roadmap order above.

M4 was reviewed and verified on PR #5, squash-merged with an expected-head guard, and the merge-triggered `main` workflow passed all required verification gates.
