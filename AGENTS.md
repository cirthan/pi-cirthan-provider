# Project Notes

## Build and Check

- Build with `npm run build`
- Clean with `npm run clean`

## Release Process

- See [docs/releases.md](docs/releases.md) for the release process

## ⚠️ IMPORTANT: Publishing Policy

**Do not publish releases unless explicitly requested by the user.**

The release process should only be triggered when the user explicitly asks you to. When requested:
- Run `npm version patch/minor/major` to bump versions
- Commit the changes
- Push tags to GitHub with `git push origin master --tags`

The GitHub Actions publish workflow will then automatically publish to npm.

If the user does not explicitly request a release, do not perform any version bumps or tag pushes.
