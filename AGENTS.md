# Agent instructions

mongozod is a MongoDB library where the Zod schema is the single source of truth for each document:
it validates what is written, types what is read and defines what each endpoint accepts. It
complements the official MongoDB driver instead of replacing it.

The roadmap in `docs/proposal/roadmap.md` marks what is implemented. The proposal in
`docs/proposal/` is the source of truth: read its README before working on any area, then the
documents of the topics you touch and the roadmap for the order of the work.

## Working rules

- Don't infer. Every decision is agreed with the maintainer or backed by official documentation.
  When in doubt, ask.
- Every solution is backed by official documentation. Integrate each library as its current docs
  say, and check the source when an API doesn't match what you expect.
- No over-engineering: prefer simple solutions that cover the normal cases and the edge cases well.
- Verify before recording: compile types with TypeScript and check behavior against MongoDB, then
  write the decision down.
- Record each decision in the proposal document of its topic, and mark roadmap phases as done, in
  the same change.

## Repository

The [repository structure](docs/proposal/structure.md) describes each folder. The package is
published as `mongozod`, and the official plugins are subpaths of it, such as
`mongozod/plugins/soft-delete`.

The [tooling](docs/proposal/structure.md#herramientas) runs from the root with pnpm:

- `pnpm build`, `pnpm check-types` and `pnpm test` run each package's task through Turborepo.
- `pnpm check-dist-types` builds the package and compiles a consumer of its declarations with
  TypeScript 5.5, the minimum, and 7.
- `pnpm check-type-cost` builds the package and fails when the type instantiations of a typical
  project, `packages/mongozod/test/type-cost/`, go over its `budget.json`. A change that raises the
  cost on purpose raises the budget in the same commit.
- `pnpm check-docs` builds the package and compiles the TypeScript examples of the README and of
  `packages/docs` against its declarations.
- `pnpm --filter website dev` runs the site, `apps/website`, which `pnpm build` also builds.
- `pnpm lint` and `pnpm format` run oxlint and oxfmt over the whole repo.
- Tests get a MongoDB 8.2 replica set from `inject('mongoUri')`.
- A change to the published package adds a changeset with `pnpm changeset`.

## Language and docs

- The proposal is in Spanish. The README, user docs, this file, skills and JSDoc are in English.
- Docs cite each other with relative links.
- The [user docs](docs/proposal/documentation.md) live in `packages/docs`, and the build ships them
  in the package. A change to the public API updates its page in the same commit, and
  `pnpm --filter @repo/docs index` rewrites their index after adding or renaming a page.

## Code

- One file, one responsibility, with a kebab-case name.
- Named exports. No barrel files, except the package entry points.
- No `as` casts.
- Use `import type` for type-only imports
- Use `node:` protocol for Node.js built-ins (e.g. `node:crypto`)
- JSDoc comments for public APIs
- Inline single-use helpers.
- Set option defaults with `??=`, not with object spreads.
- Avoid needless ternaries and guards: prefer `??`, `||` and `&&` fallbacks.
- Zod chains take one call per line.

## Errors

- No custom error classes: a failed validation throws Zod's `ZodError`, driver errors propagate
  unchanged, and an invalid configuration throws an `Error` when the model is defined.
- Propagate by default. Catch only to recover from a known error, rethrow the rest, and say why
  when it isn't obvious.
- Release resources with `finally`.

## Tests and versions

- Add tests where the logic warrants it, never for trivial code or for coverage.
- Exact versions for devDependencies. Peer dependencies keep the agreed ranges: `zod@^4.5.0` and
  `mongodb@^6.20.0 || ^7.0.0`. CI also runs the types and tests with the driver 6.20.

## Git

- Commits and pull request titles follow `type(scope): subject`, in English, with one change per
  commit.
- Use `!` for breaking changes (e.g. `feat(auth)!:`)
- A stack of pull requests means [`gh stack`](https://github.com/github/gh-stack)
  (`gh extension install github/gh-stack`): `gh stack init` or `add` builds it, `gh stack submit`
  pushes the branches and links the pull requests, `gh stack rebase` keeps it up to date and
  `gh stack merge` merges it in one operation. Never delete the branch of a pull request that
  another one of the stack is based on: GitHub closes that one.
- Never attribute co-authorship to an AI agent in commits, pull requests, comments or any other
  artifact.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
