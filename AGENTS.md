# AGENTS.md

## Project Instructions
- Review `prd.md`, `AGENTS.md`, and `architecture.md` at the start of a new session, then check Linear for current Epics/Tasks and scan relevant source files to gather context.
- At the beginning of a new session, ask the user which Linear Epic they want to focus on today.
- Do not recreate `tasks.md` or `epics.md`; use Linear as the source of truth for tasks, epics, and statuses.
- Always update Linear task status after completing any task by moving it to In Review (Awaiting Validation).
- After updating the Linear task status, explicitly confirm with the user that the task is ready for validation and wait for their approval before moving it to Done (Completed).
- Prefer small, incremental changes with clear summaries.
- Avoid large refactors unless requested.
- Keep UI changes aligned with the existing visual language.
- For any auth or security changes, call out risks and require user confirmation.
- Always use Playwright MCP tools to test all front-end changes before marking them complete
- When validating full stack changes, run Playwright MCP tests against the Docker validation container.
- Run a fresh Docker build and start a container for validation on every iteration before asking for user validation.
- When running validation containers, always mount `./data` to `/app/data` to preserve integrations between runs.
- If credentials are unknown or login fails, check Docker logs for the bootstrap admin password. If it is missing, delete the local `./data` mount and recreate the Docker container to regenerate the admin password and check the Docker logs for the password.
- If the bootstrap admin password is regenerated, relay it to the user and do not store it in committed files.
- After testing, leave the last validation container running and log in before handoff so manual testing can continue without recycling the container.
- Do not move tasks to Done without explicit user sign-off; keep them in In Review until approved.
- Maintain Linear epic/task relationships and ensure tasks are linked to the correct Epic.

## Workflow
1) Understand the request.
2) Make changes.
3) Move the Linear task to In Review (Awaiting Validation) and ensure task-to-epic mapping stays current.
5) Build a fresh Docker image and run a container for validation (with `./data:/app/data` mounted).
6) Use Playwright MCP tools against the Docker validation container (for all testing).
7) After user validation, move the task to Done (Completed) and confirm completion.

## Linear defaults
- Linear workspace: Roknua Projects
- Default Linear project: Uptime Atlas (identifier: uptime-atlas-9167969ecf12)
- Linear API key env var: `LINEAR_API_KEY` (local only; do not commit or sync). If unset, ask the user to provide a new Linear API key.
- If `LINEAR_API_KEY` is missing in the current shell, source `~/.zshrc` before using Linear, then re-check the env var.
- Linear status mapping for this project:
  - Backlog = Planned
  - In Progress = In Progress
  - In Review = Awaiting Validation
  - Done = Completed
  - Canceled = Cancelled
- When using Linear MCP:
  1) First, find/resolve the project "Uptime Atlas" (or the identifier above) and use that project for all subsequent actions.
  2) Do not create or update issues outside this project unless I explicitly say so.
  3) When creating issues, use a clear title without a "UA-##" prefix, include acceptance criteria, and label "Uptime Atlas".
  4) Refer to tickets by their Linear issue identifier going forward.
