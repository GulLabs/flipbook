# Security Policy

## Supported versions

Security fixes land on `main` and ship with the next release of the affected package. Pre-1.0 / fork-stabilization releases do not receive long-lived backport branches. Upgrade to the latest version of the package you use.

## Reporting a vulnerability

**Do not open a public issue.**

Report privately through [GitHub Security Advisories](https://github.com/GulLabs/flipbook/security/advisories/new).

We aim to acknowledge within a few business days. Please include:

- Affected package and version
- A minimal reproduction or a clear description of the impact
- Whether you believe the issue is already being exploited

We will coordinate a fix and a public advisory before any disclosure.

## Scope

- This library renders page-flip UI in the browser. Treat untrusted HTML page content the same way you would any user-controlled DOM: sanitize before `loadFromHtml` / children you do not fully control.
- Releases are intended to publish from GitHub Actions on `main` after CI is green. See [`RELEASING.md`](./RELEASING.md).
- CI runs `gitleaks` on every pull request and on `main`.
- Dependabot opens weekly PRs for npm and GitHub Actions.

## Supply chain

- Prefer installing from the published npm packages once `@gullabs/*` (or current names) are released from this repository.
- Do not paste production secrets into issues, PRs, or sample code.
