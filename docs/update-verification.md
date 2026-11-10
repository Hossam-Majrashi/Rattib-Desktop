# Update regression verification — 0.2.5

## Root cause

Update performs a fresh installed-version check before asking for approval to run the updater. The old parser required exactly one unique three-part version anywhere in the output:

- Strata printed its product version, a different build version and Python’s version.
- Hermes printed its product version, Python’s version and the OpenAI SDK version.

Both checks were therefore marked `check-failed`, so the actual updater never started. This was not a download or PTY-input failure.

Read an explicit product-version header on the first nonempty line, with an optional parenthesized build/runtime section or channel suffix. Keep the strict unambiguous-output fallback. Accept three- and four-part versions; do not extract a partial version from longer dotted strings. Failed commands and unstructured ambiguous output remain unverified. Execution confirmations and saved commands are unchanged.

## Automated verification

- `npm run check`: typecheck and 65 passing tests.
- `npm run test:smoke`: real Electron renderer, IPC and PTY; click the actual Update button with representative Strata, updated Strata and Hermes output. Assert `version → update → version`, execution of the safe updater fixture and verified saved product versions.
- Unit/operation coverage includes ANSI/CRLF output, runtime/SDK metadata, the Strata three-to-four-part version transition, ambiguous output and existing cancellation/confirmation safeguards.

Automated tests use local fixtures only. They never invoke real tool installers or updaters.

## User-requested live Linux verification

A one-off Electron harness used an isolated temporary Rattib profile, the existing installed tools and the actual renderer Update buttons. Rattib’s command confirmations were approved for these user-requested updates. No answers were injected into the tool subprocesses; existing Rattib cards/settings were not edited.

- `strata update`: downloaded and signature-checked engine `0.1.59` (723 MB) and Control `0.1.59.1` (100 MB), test-started them and switched successfully. The new product version was `0.2.13.1`, revealing the additional four-part-version regression, which was fixed and covered by tests.
- Repeated the Update-button workflow with the final parser: Strata completed all three phases, exited `0` and saved verified version `0.2.13.1`.
- `hermes update`: fetched updates on the stable channel, checked dependencies/configuration and reported already up to date. The final Update-button workflow completed all three phases, exited `0` and saved verified version `0.23.1`.

These are Linux observations, not evidence that every tool or installer works on every platform. Cross-platform packaging/tests are handled separately by GitHub Actions.
