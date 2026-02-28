---
name: release-management
description: Creates npm releases for @cirthan/pi-cirthan-provider with proper commit messages and tag pushing. Use when ready to publish new version.
---

# Release Management Skill

## Purpose

Automates the release process for the `@cirthan/pi-cirthan-provider` npm package following semantic versioning.

**Test Commit**: Branch protection testing v2 - another small change for testing.

## When to Use

Use this skill when:
- Ready to publish a new version to npm
- All changes are committed and ready for release
- You want to bump version (patch/minor/major) and publish

## How It Works

The skill handles the complete release workflow:

1. **Version Bump**: Uses `npm version <type>` to bump version in `package.json`
2. **Commit**: Creates commit with version bump message
3. **Tag & Push**: Pushes tag to trigger GitHub Actions publish workflow

## Release Types

Choose the appropriate version bump type:

- **patch** - For bug fixes (0.1.1 → 0.1.2)
- **minor** - For new features (0.1.2 → 0.2.0)
- **major** - For breaking changes (0.2.0 → 1.0.0)

## Usage

```bash
/skill:release-management minor  # For new features
/skill:release-management patch  # For bug fixes
/skill:release-management major  # For breaking changes
```

## What Happens

The `npm version` command automatically:
1. Bumps version in `package.json`
2. Creates a commit with message: `chore: bump version to X.Y.Z`
3. Creates a git tag: `vX.Y.Z`

**IMPORTANT**: Do NOT push tags automatically. The skill only does the version bump and creates the commit/tag.

You must manually push the tag to trigger publishing:
```bash
git push origin master --tags
```

This gives you a chance to review before publishing to npm.

## Post-Publish Verification

After releasing, verify with:

```bash
npm view @cirthan/pi-cirthan-provider
```

## Important Notes

- **Do NOT use** unless explicitly requested by the user
- The package uses OIDC trusted publishing (no API tokens needed)
- GitHub Actions automatically publishes when tag is pushed
- Pre-release versions use: `v0.1.0-beta.1`, `v0.1.0-rc.1`, etc.

## Example Workflow

```
User: "Do a minor release for the whisper model addition"
Agent: /skill:release-management minor
→ Commits version bump to 0.3.0
→ Pushes v0.3.0 tag
→ GitHub Actions publishes to npm
```
