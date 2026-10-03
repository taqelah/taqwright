# Security Policy

## Supported versions

taqwright is 1.x and follows semver. Releases ship from `main`, and security
fixes land only in a new release on the **latest minor of the current major**.
There are no maintenance branches, no backports to earlier minors, and no
support for a previous major once a new one ships.

| Version | Supported                    |
| ------- | ---------------------------- |
| 1.1.x   | ✅ security fixes            |
| 1.0.x   | ❌ upgrade to the latest 1.x |
| 0.0.x   | ❌ pre-1.0, end of life      |

So in practice: upgrade to the latest `1.x` release and confirm the issue still
reproduces there before reporting — if it only reproduces on an older version,
the fix is to upgrade.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via one of:

- GitHub **Security Advisories** — the "Report a vulnerability" button under the
  repository's **Security** tab (preferred); or
- email **syam.sasi@taqelah.sg**.

Include a description, affected version, and reproduction steps if possible. We
aim to acknowledge within a few business days and will coordinate a fix and
disclosure timeline with you.
