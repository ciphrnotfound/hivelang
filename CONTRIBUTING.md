# Contributing to HiveLang

Thank you for contributing. Please open an issue before starting a large grammar or runtime change so maintainers and contributors can align on the design.

## Local workflow

1. Fork the repository and create a focused branch.
2. Run `npm install`.
3. Add or update tests for every behavior change.
4. Run `npm run check`, `npm test`, and `npm run build`.
5. Open a pull request explaining the behavior change and compatibility impact.

## Design principles

- Keep the runtime provider-neutral and side-effect-free by default.
- Do not add real credentials, API keys, private prompts, or customer data to the repository.
- Preserve least privilege: a declared capability does not replace host-side authorization and validation.

By contributing, you agree that your contributions are licensed under Apache-2.0.
