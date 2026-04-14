# Tilde Path Extension

Displays the current working directory in the system prompt using `~` notation
instead of absolute paths.

## Example

Before:
```
Current working directory: /Users/username/projects/my-app
```

After:
```
Current working directory: ~/projects/my-app
```

## Installation

Copy this directory to:
- `~/.pi/agent/extensions/tilde-path/` (global - all projects)
- `.pi/extensions/tilde-path/` (project-local)

## How It Works

Listens to the `before_agent_start` event and modifies the system prompt's
working directory line using a regex replacement. Paths outside the home
directory are left unchanged.
