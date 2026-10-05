# Code signing policy

Gigabeam's Windows downloads (the installer and the portable `.exe`) are digitally signed, so Windows can show who published the file and that it has not been changed since it was built.

**Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).**

## What is signed

Only the two Windows files that the release workflow builds from this repository's source code:

- `Gigabeam-Setup-<version>.exe`
- `Gigabeam-Portable-<version>.exe`

They are built by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) from the tagged commit, with nothing added by hand, and then submitted to SignPath for signing. Gigabeam contains no closed-source parts.

When you look at the file's **Properties → Digital Signatures** in Windows, the publisher shows as **SignPath Foundation**. That is expected: the certificate belongs to the foundation, which signs open-source releases whose builds it can trace back to the public source code.

## Who does what

| Role | Person | What they do |
| --- | --- | --- |
| Author | [Kristian Carl B. Fontanilla](https://github.com/fontanillakristian) | Writes and maintains the source code |
| Reviewer | [Kristian Carl B. Fontanilla](https://github.com/fontanillakristian) | Reviews changes before they are merged |
| Approver | [Kristian Carl B. Fontanilla](https://github.com/fontanillakristian) | Approves each release for signing |

Everyone with a role uses multi-factor authentication on GitHub and SignPath.

## Privacy

Gigabeam does not send any data anywhere. PDFs are opened, edited and saved on your own computer, the program makes no network requests of its own, and it has no analytics or tracking. Nothing is uploaded.

## Reporting a problem

If you find a Gigabeam download that is signed but that you think is not genuine, or you have a security concern, please [open an issue](https://github.com/fontanillakristian/gigabeam/issues) or contact the maintainer through the address on the GitHub profile.
