# Public Bug-Bounty Policy Snapshot — 2026-11-25

## Purpose and handling

This is a dated, desk-research snapshot for program-selection and authorization parsing. It is not an authorization to test any listed asset. No target was probed, scanned, enumerated, authenticated to, or contacted for this review. Program terms can change; re-open the live policy immediately before any proposed research and record its exact version/date.

## Directory and policy sources

- HackerOne Directory: https://hackerone.com/directory/programs
  - Use the live program page for current acceptance status, eligible assets, scope exclusions, reward ranges, submission rules, and response metrics.
  - The directory distinguishes active submission, bounty availability, collaboration, retesting, and managed triage. These are discovery filters, not permission to test.
- HackerOne Safe Harbor overview: https://docs.hackerone.com/en/articles/8494502-safe-harbor-overview-faq
  - Gold Standard Safe Harbor (traditional systems) and AI Research Safe Harbor are separate. A program may adopt either or both. Safe harbor does not enlarge the explicitly defined asset scope.
- Bugcrowd Engagement Brief: https://docs.bugcrowd.com/customers/engagement-management/engagement-brief/
  - Read target groups, in/out-of-scope classification, asset-level rewards, testing rules, disclosure, and Safe Harbor status. The platform's broad scope rating is not an asset authorization.
- Bugcrowd researcher brief guidance: https://docs.bugcrowd.com/researchers/engagement-management/details/
  - Review the complete engagement brief before any research; target and reward details, known issues, and disclosure rules are part of the engagement.

## Fresh public program examples

### ExpressVPN — YesWeHack

Live page: https://yeswehack.com/programs/expressvpn-bug-bounty-program

Search snapshot identifies the program as public and last updated 2026-11-03.

- Normal published grid for the listed High-value assets: Low $200, Medium $600, High $1,250, Critical $2,500.
- The page advertises a one-time $100,000 TrustedServer bonus for the first valid, in-scope critical finding meeting the specified privacy/security impact and evidence requirements. The bonus is conditional, not a normal bounty.
- Explicit scope includes listed ExpressVPN services and applications, selected API and engineering domains, Lightway and WolfSSL repositories, and only the VPN server subset visible through official applications. The page states that the full server list is not public.
- Exclusions/restrictions include unlisted domains, DoS, service degradation, high-volume automated scanning, user-data manipulation/extraction, and public disclosure. Certain credential/PII reports require strict minimization and source/scope relevance.
- The policy requires complete reports with impact, reproduction, proof, and remediation; insufficient reports may be closed.
- Safe-harbor status was not independently confirmed in the extracted program text for this snapshot. Do not infer it from the platform or program category; check the live Safe Harbor section.

### 3DS OUTSCALE — YesWeHack

Live page: https://yeswehack.com/programs/outscale

Directory snapshot lists the program as public, seven scopes, last updated 2026-08-31.

- Published rewards: €50 Low, €100 Medium, €500 High, €1,000 Critical; advertised critical maximum €5,000.
- Focus is the cloud service, not the company's general websites. The policy describes API endpoints in the eu-west-2 region and the Cockpit interface as in scope; public company sites and documentation are excluded.
- Availability/DoS findings are out of scope. Customer data, customer resources, and 3DS OUTSCALE production data must not be accessed, altered, or disrupted. Proof of concept is required.
- Account creation requires contacting the program; do not attempt to self-provision or use the public form as a test target.
- Safe-harbor terms were not confirmed in the extracted program text; check the live program before considering any research.

## Policy parser requirements reinforced by this review

Represent each program and each asset separately:

1. exact scope locator and asset owner;
2. in-scope / out-of-scope / unknown;
3. scope version and program update date;
4. traditional safe harbor and AI safe harbor as independent fields;
5. safe-harbor evidence URL and exact policy text;
6. per-asset reward grid, currency, caps, and conditional bonuses;
7. prohibited techniques, automation limits, data-handling constraints, and disclosure rules;
8. account/credential requirements and third-party exclusions;
9. source timestamp, retrieval date, and confidence.

Unknown means unknown: absence of a parsed safe-harbor statement is not proof of no protection, and platform safe harbor is not proof that a specific program adopted it. No numeric rate limit should be invented from qualitative language.

## Authorized practice

Only use an explicitly assigned PortSwigger Web Security Academy lab, a local vulnerable VM, or a specifically authorized CTF. Preserve lab identifier, exact scope, technique, evidence, and remediation. Do not convert directory discovery into public-target testing.
