# Milestone Status

This ledger tracks the ordered implementation roadmap for AI Lead Intelligence CRM.

| Milestone | Name | Status |
| --- | --- | --- |
| M0 | Foundation | Complete |
| M1 | Durable PostgreSQL Job System | Complete |
| M2 | Campaign Management | Complete |
| M3 | Search Planner | Complete |
| M4 | Browser Business Discovery | Current candidate — implementation complete, pending final review/PR/merge/main CI |
| M5 | Deduplication Engine | Remaining |
| M6 | Domain Resolution & Website Verification | Remaining |
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

## Current boundary

M4 delivers real browser-based public business discovery behind a provider-neutral package, normalized candidates and source provenance, provider usage accounting, durable cursor/page continuation, crash-safe next-page scheduling repair, stale-generation protection for pause/resume/cancel, bounded browser concurrency, deterministic real-Chromium fixture tests, and an optional fail-closed AI page classifier.

M4 does not include canonical cross-source deduplication, domain resolution, crawling, enrichment, website audits, AI research, lead scoring, CRM/outreach, or autonomous campaign behavior. Those remain in M5+ in the roadmap order above.

M4 is not marked **Complete** until the exact reviewed head passes branch CI, PR CI passes on that same head, the PR is squash-merged with an expected-head guard, and the merge-triggered `main` CI passes every required gate.
