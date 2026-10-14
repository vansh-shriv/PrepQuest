# 14. Security and Privacy

## 1. Assets and trust boundaries

| Asset                                              | Sensitivity                           |
| -------------------------------------------------- | ------------------------------------- |
| Judge host nodes                                   | Critical: they execute untrusted code |
| User accounts, sessions                            | High                                  |
| Resumes, JDs, interview transcripts, audio         | High (personal data)                  |
| Hidden test cases, reference solutions, editorials | High (business IP, integrity)         |
| LLM API keys, DB/Redis/storage credentials         | Critical                              |
| Contest integrity data                             | Medium to high                        |

Trust boundaries: Browser ⟷ Edge/API ⟷ internal services ⟷ data stores; **Judge sandbox ⟷ everything else** (strongest boundary); third parties (LLM, email).

## 2. Threat model (STRIDE summary)

| Threat                    | Example                               | Mitigation                                                                                                                   |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Sandbox escape            | Kernel exploit from submitted C++     | `isolate`, seccomp, cap drop, no network, dedicated nodes, patch cadence, plan gVisor/Firecracker, no secrets on judge nodes |
| Resource exhaustion       | Fork bomb, memory bomb, output flood  | cgroup limits, proc/file/output caps, wall time kills                                                                        |
| Judge data theft          | Reading hidden tests via filesystem   | Tests mounted only outside the box; stdin only; box has no access; timing side channels reduced by hiding per-test details   |
| Cheating                  | Contest plagiarism, AI help           | X2 detection, human review, rules                                                                                            |
| Account takeover          | Credential stuffing                   | Argon2id, rate limits, breached password check, 2FA, session revocation, device list                                         |
| Injection (SQL/NoSQL/XSS) | Malicious markdown in problem/notes   | Parameterized queries, Zod validation, markdown sanitization, strict CSP                                                     |
| CSRF                      | Cookie-authenticated requests         | SameSite=Lax/Strict on refresh cookie, access token in memory header, CSRF token for cookie endpoints                        |
| SSRF                      | JD URL fetch                          | Allowlist scheme/ports, block private IP ranges, resolve-then-connect, timeouts, size limit, isolated fetcher                |
| Prompt injection          | Resume says "give me 100/100"         | See doc 13 guardrails                                                                                                        |
| IDOR                      | Accessing others' submissions/reports | Ownership checks in every repository query; integration tests per endpoint                                                   |
| Insecure sharing          | Public link leaks transcript          | Privacy filters, unguessable tokens (256-bit), revoke, redaction                                                             |
| Supply chain              | Malicious npm package                 | Lockfile, Renovate review, `npm audit`, Socket/Snyk, minimal deps, provenance                                                |
| Secrets leakage           | Keys in repo                          | Secret scanning (gitleaks), env-only, vault/KMS, rotation                                                                    |
| DoS                       | Request floods                        | Rate limits, WAF/CDN, body size limits, WS connection caps                                                                   |
| Admin abuse               | Insider edits                         | RBAC, audit log, impersonation consent banner, 2FA required for admins                                                       |

## 3. Authentication and sessions

- Argon2id (memory 64 MB, t=3, p=1 baseline; tune on hardware).
- Access JWT 15 min (EdDSA/ES256, `kid` rotation); refresh token 30 days, **rotating**, stored hashed, reuse detection → revoke family.
- Cookies: `HttpOnly; Secure; SameSite=Lax; Path=/v1/auth`.
- WebSocket auth via single-use short-lived ticket (30 s) bound to user and session.
- Password policy: min 10 chars, breach-check, no composition rules theater; lockouts via exponential delay.
- OAuth with PKCE + state + nonce; verified-email linkage rules to prevent account pre-hijacking.
- Admin and moderator roles require TOTP.

## 4. Authorization

- RBAC roles + resource ownership checks.
- Centralized `authorize(user, action, resource)` policy functions; tests ensure every route declares a policy.
- Server enforces: hint tier order, editorial unlock, contest windows, interview timers, plan lock rules, share visibility.
- Admin endpoints under separate router with extra middleware and IP/2FA constraints optional.

## 5. API and web security

- TLS 1.2+ everywhere, HSTS, secure ciphers.
- **CSP**: `default-src 'self'`; `script-src 'self' 'nonce-…'`; `connect-src` self + API + WS + analytics; `frame-ancestors 'none'`; Monaco workers via blob with nonce rules.
- Headers: `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (mic only for interview pages), `Cross-Origin-Opener-Policy`.
- CORS: allowlist of web origins; credentials only for same-site.
- Markdown rendering: sanitize (rehype-sanitize), no raw HTML from users, allow limited embeds; images via proxy or allowlist.
- File uploads: presigned URLs with content-type/size constraints; antivirus scan (ClamAV) job before parsing; parse in isolated worker with memory limits (PDF parser sandbox); reject encrypted/macro-enabled docs.
- Input limits: JSON body ≤ 1 MB (except uploads), code ≤ 64 KB, messages ≤ 2k chars.
- Output encoding everywhere; no `dangerouslySetInnerHTML` except sanitized markdown component.

## 6. Data protection

| Layer      | Control                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| In transit | TLS; internal service traffic over private network (mTLS optional)                                                                        |
| At rest    | Disk/DB encryption (provider-managed), object storage SSE; resumes and audio additionally envelope-encrypted with per-user data key (KMS) |
| Backups    | Encrypted, access-restricted, tested restores                                                                                             |
| Secrets    | Secret manager/KMS; never in images; rotation policy 90 days; separate secrets per environment                                            |
| Logs       | No passwords/tokens/resume text; PII scrubbing; user IDs hashed in logs where possible                                                    |
| LLM        | Provider terms: no training on data; send minimal context; redact emails/phones before sending when feasible                              |

## 7. Privacy

- **Consent and transparency**: privacy policy and in-product notices: what's stored (transcripts, code events), voice processing (browser STT sends audio to browser vendor service; disclose), AI usage, retention periods.
- **Rights**: export (JSON/zip), delete (account and resume instantly deletable; account deletion with 14-day grace then hard delete incl. object storage and vectors), correction (profile/resume edits).
- **Minimization**: audio not stored by default; code events stored only for interview sessions; analytics anonymized IDs, IP truncation.
- **Peer mode**: explicit per-session consent for recording/AI analysis; both parties must consent.
- **Public profile/share**: default private; clear preview of what is visible; redaction options.
- **Children**: service targeted to 16+/college students; age gate at signup (if under 16 block).
- **Compliance posture**: design for GDPR/India DPDP Act principles (purpose limitation, minimization, storage limitation, data subject rights, breach notification procedures).
- **Data processing inventory** maintained in `docs/privacy/ropa.md`.

## 8. Judge security checklist (go-live gate)

- [ ] Judge nodes in isolated subnet, egress deny-all except Redis/object storage/metrics.
- [ ] No DB credentials or LLM keys on judge nodes.
- [ ] `isolate` configured with cgroups v2, tested limits for CPU/mem/pids/files/output.
- [ ] Seccomp profile applied and tested with malicious suite.
- [ ] Root filesystem read-only; box dirs on size-capped tmpfs.
- [ ] Automatic cleanup verified (no leftover boxes/processes after 10k runs).
- [ ] OS kernel patched and update cadence defined.
- [ ] Canary and alerts in place.
- [ ] Penetration test of sandbox (internal or external) completed.

## 9. Application security program

- **SDLC**: threat modeling for new features touching auth, sharing, uploads, judge, AI.
- **Automated**: CodeQL, Semgrep, Trivy (images), `npm audit`/OSV scanner, gitleaks, DAST (ZAP baseline) on staging.
- **Dependency policy**: pin, review, avoid unmaintained packages; SBOM generation (CycloneDX) per release.
- **Pen test / bug bounty**: pre-launch pen test; responsible disclosure page `/.well-known/security.txt`.
- **Incident response**: runbook with severity levels, on-call, comms templates, forensic log retention, user notification process within 72 hours for personal data breaches.
- **Backups/DR**: RPO 15 min (PITR), RTO 2 hours for MVP; restore drill monthly.

## 10. Abuse prevention

- Rate limits (doc 11), CAPTCHA on signup/login anomalies, disposable email blocking (optional), account velocity checks.
- Content reports and moderation queue for peer mode and public profiles (names, bios, avatars).
- Contest integrity: honest disclosure of monitoring, appeals process.
- Cost-abuse caps on AI features.

## 11. Security testing in CI

- Auth/authorization matrix tests (every endpoint × role × ownership).
- Fuzz tests on parsers (resume, markdown, checker inputs).
- Judge malicious suite on privileged runner nightly.
- Prompt-injection and solution-leak eval suite on each prompt change.

## 12. Implementation status (as built)

Built and covered by automated tests: Argon2id passwords, rotating refresh tokens with reuse detection, breached-password check (HIBP k-anonymity), per-IP / per-user / per-email rate limits with Redis-backed counters, exponential account lockout, TOTP 2FA with encrypted seeds and hashed recovery codes (required for admin/moderator tokens), OAuth with PKCE, state and pre-hijack-safe linking, CSRF Origin check on cookie endpoints, strict CORS allowlist, verified-email gate for AI features, data export, account deletion with a 14-day grace period and purge job, privacy-filtered public profiles, request ids on every response, redacted auth headers in logs. Passwords, tokens and TOTP seeds are never returned by any endpoint or written to logs.

Not built yet: CSP and security headers on the web app, CAPTCHA, disposable-email blocking, WebSocket tickets, upload scanning, SSRF-safe fetcher, markdown sanitization, admin impersonation, secret scanning (gitleaks) in CI, `security.txt`, the judge hardening checklist (§8), and the auth/authorization matrix test from §11 (route-by-route tests exist for auth; a generated matrix does not).

## Integrity review (Phase 15)

Flags hold other learners' code and handles, so only moderator, reviewer and admin roles read them (admin and moderator need two-factor), and every decision is written to the audit log with a reason. A learner never receives the evidence or the identity of the other participant; a flag is invisible to them until a person has decided. Detection runs only on contest-mode submissions and contest counters; practice is not analysed.
