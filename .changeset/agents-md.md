---
'mongozod': minor
---

`npx mongozod agents-md` writes the mongozod rules for coding agents to `AGENTS.md`, or to the file of `--output`, such as `CLAUDE.md`: a short block between its markers that points the agent at the docs of the installed version, created when the file is missing, replaced when it has it, and appended otherwise, without touching the rest. The block also asks the agent to suggest that the user report a friction or a case the docs do not cover as an issue, which is reviewed promptly, without opening it itself.
