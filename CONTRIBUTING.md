# Contributing

Thanks for helping. A few ground rules keep the project easy to run.

## Branches and pull requests

- **Open every pull request against `dev`** (the default branch).
  Nobody pushes to `dev` or `main` directly — maintainers included.
- `main` only takes pull requests from `dev`, when a set of changes has
  been tested on real boards. A check fails any other PR into `main`.
- Keep a PR to one change; say what you tested and on which boards.

## Repository conventions

Read [`CLAUDE.md`](CLAUDE.md) first: `pinmap.yaml` and `boards/*.yaml`
are the single sources of truth (regenerate with `tools/genpins.py` /
`tools/genboards.py` and commit the result), and the locked design
decisions there aren't reopened without saying why their reasoning no
longer holds. Before a PR:

```
python3 tools/genpins.py --check && python3 tools/genboards.py --check && python3 tools/genmsg.py --check
pio test -d firmware/test -e native
pio run -d firmware/node
cd console && npm run typecheck && npm run build
```

## Licensing of contributions

Contributions are accepted under the project's licenses
([`LICENSING.md`](LICENSING.md)) for the part of the tree they touch.
By opening a pull request you also confirm that:

1. **You wrote it, or have the right to submit it** under those
   licenses — the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
   Sign each commit with `git commit -s`.
2. **You allow the copyright holder (Colin Willson) to also license your
   contribution under other terms**, including commercial licenses. This
   keeps the project able to grant exceptions (`LICENSING.md`,
   "Commercial licenses") without tracking down every contributor; your
   contribution stays available under the open licenses regardless.

Don't paste in code from projects without a license, or under a license
incompatible with GPL-3.0 / AGPL-3.0 / CERN-OHL-S — see
[`THIRD_PARTY.md`](THIRD_PARTY.md) for how the BRMesh protocol was
handled.
