# CLAUDE.md — docs/

Developer-facing documentation for the platform. All files in English.
Scaffolded progressively alongside the implementation phases.

## Files (target state after Phase Group 24)

| File                 | Phase | Contents                                              |
| -------------------- | ----- | ----------------------------------------------------- |
| `architecture.md`    | 24A   | System diagram, component responsibilities, data flow |
| `module-contract.md` | 24B   | How to write a new business module end-to-end         |
| `api-conventions.md` | 24C   | Response shape, errors, pagination, auth, rate limits |
| `auth-flow.md`       | 24D   | OTP flow, JWT lifecycle, refresh rotation, TOTP       |
| `security.md`        | 24E   | Threat model, security controls, audit log policy     |
| `deployment.md`      | 24F   | VPS provisioning, Caddy config, Docker Compose prod   |
| `operations.md`      | 24F   | Backup, restore drill, monitoring, on-call runbook    |

## Convention

- Diagrams use ASCII art (no external renderer required)
- Code examples use TypeScript
- All endpoint examples use the canonical `/api/v1/{module}/{resource}` base path
