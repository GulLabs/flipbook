# Security Policy

## Supported versions

Security fixes land on `main` and ship with the next release of the affected package. Pre-1.0 / fork-stabilization releases do not receive long-lived backport branches. Upgrade to the latest version of the package you use.

## Reporting a vulnerability

**Do not open a public issue.**

Report privately through [GitHub Security Advisories](https://github.com/gul-labs/flipbook/security/advisories/new).

We aim to acknowledge within a few business days. Please include:

- Affected package and version
- A minimal reproduction or a clear description of the impact
- Whether you believe the issue is already being exploited

We will coordinate a fix and a public advisory before any disclosure.

## Scope — XSS / HTML sinks

This library renders page-flip UI in the browser. **There is no built-in HTML sanitization.** Nodes are moved or cloned as-is into the engine DOM.

Treat untrusted page content the same way you would any user-controlled DOM: sanitize **before** handing nodes to the engine.

| Sink               | API                                                      | Risk                                                                                                                                                        |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML page elements | `PageFlip.loadFromHTML(items)` / `updateFromHtml(items)` | Caller-owned elements are adopted into `.stf__block`                                                                                                        |
| React children     | `<HTMLFlipBook>{children}</HTMLFlipBook>`                | Same DOM ownership path via portal                                                                                                                          |
| Image page URLs    | `PageFlip.loadFromImages(hrefs)`                         | `href` used as image sources                                                                                                                                |
| Fold fill color    | setting `pageBackground`                                 | Validated to a safe CSS color subset; invalid values fall back to `#fff` (not a script XSS sink in modern browsers, but still style injection if unchecked) |

Correct method names use camelCase `loadFromHTML` / `updateFromHtml` (not `loadFromHtml`).

## Releases and CI

- Releases publish from GitHub Actions on `main` after the Release workflow `gate` job (gitleaks + audit + `quality:ci`). See [`RELEASING.md`](./RELEASING.md).
- Publish uses **OIDC trusted publishing** with provenance — no long-lived npm token in the workflow.
- CI runs `gitleaks` on every pull request and on `main`.
- Dependabot opens weekly PRs for npm and GitHub Actions.
- Install lifecycle scripts are allow-listed via `pnpm.onlyBuiltDependencies` in the root `package.json`.

## Supply chain

- Prefer installing from the published npm packages once `@gullabs/*` are released from this repository.
- Do not paste production secrets into issues, PRs, or sample code.
- Published package tarballs ship **`dist/` only** (no `src/`).
