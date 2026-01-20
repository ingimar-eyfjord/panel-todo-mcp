# Panel Todo MCP

[![npm version](https://img.shields.io/npm/v/panel-todo-mcp.svg)](https://www.npmjs.com/package/panel-todo-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

MCP server for [Panel Todo](https://panel-todo.com) — lets AI assistants manage your tasks, issues, and sprints directly in VS Code.

## Install

```bash
npm install -g panel-todo-mcp
```

## Setup

Add to your MCP configuration (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "panel-todo": {
      "command": "npx",
      "args": ["panel-todo-mcp"],
      "env": {
        "PANEL_TODO_PROJECT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

## What It Does

Panel Todo is a VS Code extension that puts a todo list in your Panel area (next to Terminal and Problems). This MCP server gives AI assistants direct access to that task list.

- **Free tier**: 5 tools for local todos stored in `.vscode/panel-todo.json`
- **Pro tier**: 38 tools for issues, sprints, projects, tags, and comments with cloud sync

## Tools

### Free Tier — Local Storage (5 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_add` | Add a new todo |
| `panelTodo_list` | List all todos |
| `panelTodo_update` | Update a todo's text |
| `panelTodo_complete` | Mark a todo as complete |
| `panelTodo_remove` | Remove a todo |

### Configuration (2 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_configure` | Set up Pro connection |
| `panelTodo_status` | Check configuration and Pro status |

### Issues — Pro (8 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listIssues` | List all issues (filter by status/sprint) |
| `panelTodo_searchIssues` | Search issues with text query and filters |
| `panelTodo_getIssue` | Get issue by ID or key (e.g., "PT-1") |
| `panelTodo_addIssue` | Create a new issue |
| `panelTodo_batchCreateIssues` | Create multiple issues at once |
| `panelTodo_updateIssue` | Update an issue |
| `panelTodo_completeIssue` | Mark issue as done |
| `panelTodo_deleteIssue` | Delete an issue |

### Sprints — Pro (9 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listSprints` | List all sprints |
| `panelTodo_getSprint` | Get sprint details with issues |
| `panelTodo_createSprint` | Create a new sprint |
| `panelTodo_updateSprint` | Update sprint name or dates |
| `panelTodo_startSprint` | Start a sprint |
| `panelTodo_completeSprint` | Complete a sprint |
| `panelTodo_deleteSprint` | Delete a sprint |
| `panelTodo_moveIssueToSprint` | Move an issue to a sprint |
| `panelTodo_getBacklog` | Get backlog issues |

### Projects — Pro (4 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listProjects` | List all projects |
| `panelTodo_switchProject` | Switch to a different project |
| `panelTodo_createProject` | Create a new project |
| `panelTodo_deleteProject` | Delete a project |

### Tags — Pro (6 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listTags` | List all tags |
| `panelTodo_createTag` | Create a new tag |
| `panelTodo_updateTag` | Update a tag |
| `panelTodo_deleteTag` | Delete a tag |
| `panelTodo_addTagToIssue` | Add tag to issue |
| `panelTodo_removeTagFromIssue` | Remove tag from issue |

### Comments — Pro (4 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listComments` | List comments on an issue |
| `panelTodo_addComment` | Add a comment |
| `panelTodo_updateComment` | Update a comment |
| `panelTodo_deleteComment` | Delete a comment |

## Examples

### Quick todos (Free)

```javascript
// Add a task
panelTodo_add({ text: "Fix login bug" })

// Check your list
panelTodo_list()

// Done
panelTodo_complete({ id: "<id>" })
```

### Issue tracking (Pro)

```javascript
// Create an issue
panelTodo_addIssue({
  title: "Add dark mode support",
  priority: "high"
})
// Returns: { issue: { key: "PT-3", id: "..." } }

// Start working on it
panelTodo_updateIssue({
  issueId: "<id>",
  status: "in_progress"
})

// Add notes
panelTodo_addComment({
  issueId: "<id>",
  content: "Using CSS variables for theming"
})

// Complete
panelTodo_completeIssue({ issueId: "<id>" })
```

### Sprint planning (Pro)

```javascript
// Create a sprint
panelTodo_createSprint({
  name: "Sprint 1",
  startDate: "2024-01-15",
  endDate: "2024-01-29"
})

// Add issues in bulk
panelTodo_batchCreateIssues({
  sprintId: "<sprint-id>",
  issues: [
    { title: "User authentication", priority: "high" },
    { title: "Password reset flow", priority: "medium" },
    { title: "Session management", priority: "medium" }
  ]
})

// Start the sprint
panelTodo_startSprint({ sprintId: "<sprint-id>" })
```

## Pro Configuration

To use Pro features:

```javascript
panelTodo_configure({
  projectId: "your-project-id",
  token: "pt_your_api_token"
})
```

Get your token from the Panel Todo VS Code extension: **Account tab → Create API Token**

For local development:

```javascript
panelTodo_configure({
  projectId: "your-project-id",
  devMode: true,
  devUserId: "test-user-id"
})
```

## Links

- [Panel Todo Extension](https://marketplace.visualstudio.com/items?itemName=paneltodo.panel-todo) — VS Code Marketplace
- [panel-todo.com](https://panel-todo.com) — Pro subscription
- [GitHub](https://github.com/ingimar-eyfjord/panel-todo) — Source code

## License

MIT
