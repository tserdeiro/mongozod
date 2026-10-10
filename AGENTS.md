# Agent instructions

mongozod is a MongoDB library where the Zod schema is the single source of truth for each document:
it validates what is written, types what is read and defines what each endpoint accepts. It
complements the official MongoDB driver instead of replacing it.

Nothing is implemented yet. The proposal in `docs/proposal/` is the source of truth: read its README
before working on any area, then the documents of the topics you touch and the roadmap for the
order of the work.

## Working rules

- Don't infer. Every decision is agreed with the maintainer or backed by official documentation.
  When in doubt, ask.
- Every solution is backed by official documentation. Integrate each library as its current docs
  say, and check the source when an API doesn't match what you expect.
- No over-engineering: prefer simple solutions that cover the normal cases and the edge cases well.
- Ask through short quizzes, with your recommendation first. Give pros and cons when asked.
- Verify before recording: compile types with TypeScript and check behavior against MongoDB, then
  write the decision down.
- Record each decision in the proposal document of its topic, and mark roadmap phases as done, in
  the same change.

## Repository

The [repository structure](docs/proposal/structure.md) describes each folder. The package is
published as `mongozod`, and the official plugins are subpaths of it, such as
`mongozod/plugins/soft-delete`.

There is no tooling yet: setting it up is the first phase of the
[roadmap](docs/proposal/roadmap.md).

## Language and docs

- The proposal is in Spanish. The README, user docs, this file, skills and JSDoc are in English.
- Docs cite each other with relative links.

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
  `mongodb@^7.0.0`.

## Git

- Commits and pull request titles follow `type(scope): subject`, in English, with one change per
  commit.
- Use `!` for breaking changes (e.g. `feat(auth)!:`)
- Never attribute co-authorship to an AI agent in commits, pull requests, comments or any other
  artifact.
