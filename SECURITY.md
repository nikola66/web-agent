# Security Policy

## Supported Versions

This project is currently maintained on the latest default branch and the latest tagged release.

| Version | Supported |
| --- | --- |
| Latest `main` | Yes |
| Latest release | Yes |
| Older releases | No |

## Reporting A Vulnerability

Please do not open a public issue for security-sensitive bugs.

Use one of these private paths instead:

1. Open a GitHub private vulnerability report for this repository if the feature is enabled.
2. If private reporting is not available, contact the maintainer through the contact path exposed on the project profile or website and clearly mark the message as a security report.

Include:

- a short description of the issue
- impact and affected area
- reproduction steps or proof of concept
- browser, OS, and deployment details
- whether the issue affects the hosted demo, local development, or both

I will acknowledge valid reports as quickly as possible, work on a fix, and coordinate disclosure once a patch is available.

## Security Posture

Web Agent is designed as a browser-native, local-first system:

- workspaces, sessions, memory, skills, and runtime state persist in browser storage
- credentials are stored locally and encrypted before persistence
- profiles are isolated from each other
- hosted deployments should remain transit-only for upstream requests, not persistence backends for user data

## Scope Notes

Security reports are especially useful for issues involving:

- workspace isolation failures
- data leakage across profiles
- credential exposure
- unintended persistence of prompts, files, or memory on hosted infrastructure
- unsafe path handling, upload handling, or shell execution behavior
