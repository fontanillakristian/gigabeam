# Contributing

Thanks for helping out. Bug reports, ideas and pull requests are all welcome.

## License of contributions

This project is licensed under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)). By contributing you agree that your contribution is licensed under the same terms. You keep the copyright on what you write.

## Sign your commits (DCO)

Every commit must carry a `Signed-off-by` line. It certifies the [Developer Certificate of Origin](https://developercertificate.org/): that you wrote the change, or otherwise have the right to submit it under this project's license.

Add it automatically with `-s`:

```bash
git commit -s -m "Describe your change"
```

That appends `Signed-off-by: Your Name <your@email>`, using the name and email from your git config.

Forgot? Fix the last commit:

```bash
git commit --amend -s --no-edit
```

or a whole branch of commits:

```bash
git rebase --signoff main
```

then `git push --force-with-lease`.

## Making a change

1. Fork the repository and create a branch.
2. There is no build step: serve the folder (`npx serve .`) and open it in a browser. See the README for the code layout, and keep the load order in `js/boot.js` in mind.
3. Try your change with a real PDF, including undo / redo and saving, then re-open the saved file.
4. Open a pull request describing what changed and why. Small, focused pull requests are easiest to review.
