# Panel Todo MCP Server

MCP (Model Context Protocol) server for Panel Todo, enabling AI assistants like Claude to manage todos, issues, sprints, and more.

**33 tools** for complete task and project management.

## Installation

```bash
npm install panel-todo-mcp
```

## Usage

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

## For AI Assistants

### The Context Problem

Your internal todo list dies when the session ends. The user can't see it. The next AI session starts from scratch.

**Panel Todo solves this** by persisting tasks to disk, showing them in VS Code, and letting future sessions continue where you left off.

### The Golden Rule

> **You can use your internal todo system for your own tracking.**
> **But ALWAYS ALSO write to Panel Todo when it's available.**

This maintains context across sessions - the whole point of the tool.

### At Session Start (ALWAYS DO THIS)

```javascript
// 1. Check configuration
panelTodo_status()

// 2. Read existing work
panelTodo_listIssues()  // Pro
panelTodo_list()        // Free

// 3. Check in-progress items
panelTodo_listIssues({ status: "in_progress" })

// 4. Ask user if they want to continue existing work
```

### During Work

```javascript
// Create trackable issue
panelTodo_addIssue({
  title: "Fix authentication bug",
  priority: "high"
})

// Update as you progress
panelTodo_updateIssue({ issueId: "<id>", status: "in_progress" })

// Document decisions for future sessions
panelTodo_addComment({
  issueId: "<id>",
  content: "Using JWT because existing auth middleware expects it"
})

// Complete when done
panelTodo_completeIssue({ issueId: "<id>" })
```

## Available Tools (33)

### Free Tier - Local Storage (5 tools)

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
| `panelTodo_configure` | Set up Pro connection (API URL, token, project) |
| `panelTodo_status` | Check configuration and Pro status |

### Issues - Pro (8 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listIssues` | List all issues (filter by status/sprint) |
| `panelTodo_searchIssues` | Search issues with text query and filters |
| `panelTodo_getIssue` | Get single issue by ID or key (e.g., "PT-1") |
| `panelTodo_addIssue` | Create a new issue |
| `panelTodo_batchCreateIssues` | Create multiple issues at once |
| `panelTodo_updateIssue` | Update an existing issue |
| `panelTodo_completeIssue` | Mark an issue as done |
| `panelTodo_deleteIssue` | Permanently delete an issue |

### Sprints - Pro (7 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listSprints` | List all sprints |
| `panelTodo_createSprint` | Create a new sprint |
| `panelTodo_updateSprint` | Update sprint name or dates |
| `panelTodo_startSprint` | Start a sprint (planning -> active) |
| `panelTodo_completeSprint` | Complete a sprint |
| `panelTodo_moveIssueToSprint` | Move an issue to a sprint |
| `panelTodo_getBacklog` | Get issues in the backlog |

### Projects - Pro (3 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listProjects` | List all your projects |
| `panelTodo_switchProject` | Switch to a different project |
| `panelTodo_createProject` | Create a new project |

### Tags - Pro (6 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listTags` | List all tags for the current project |
| `panelTodo_createTag` | Create a new tag |
| `panelTodo_updateTag` | Update a tag's name or color |
| `panelTodo_deleteTag` | Delete a tag |
| `panelTodo_addTagToIssue` | Add a tag to an issue |
| `panelTodo_removeTagFromIssue` | Remove a tag from an issue |

### Comments - Pro (2 tools)

| Tool | Description |
|------|-------------|
| `panelTodo_listComments` | List comments on an issue |
| `panelTodo_addComment` | Add a comment to an issue |

## Workflow Examples

### Starting a Session

```javascript
// 1. Check configuration
panelTodo_status()

// 2. See current issues
panelTodo_listIssues()

// 3. Check what's in progress
panelTodo_listIssues({ status: "in_progress" })
```

### Working on a Feature

```javascript
// 1. Create issue for the work
panelTodo_addIssue({
  title: "Add dark mode support",
  priority: "medium"
})
// Returns: { issue: { key: "PT-3", ... } }

// 2. Start working on it
panelTodo_updateIssue({
  issueId: "<id>",
  status: "in_progress"
})

// 3. Add context as you work
panelTodo_addComment({
  issueId: "<id>",
  content: "Implemented CSS variables for theming"
})

// 4. Complete when done
panelTodo_completeIssue({ issueId: "<id>" })
```

### Using Tags

```javascript
// Create tags for categorization
panelTodo_createTag({ name: "bug", color: "#FF5733" })
panelTodo_createTag({ name: "feature", color: "#33FF57" })

// Apply to issues
panelTodo_addTagToIssue({ issueId: "<id>", tagId: "<tag-id>" })
```

### Sprint Planning

```javascript
// Create a sprint
panelTodo_createSprint({
  name: "Sprint 1",
  startDate: "2024-01-15",
  endDate: "2024-01-29"
})

// Move issues into it
panelTodo_moveIssueToSprint({ issueId: "<id>", sprintId: "<sprint-id>" })

// Start the sprint
panelTodo_startSprint({ sprintId: "<sprint-id>" })
```

## Pro Configuration

To use Pro features, configure the MCP server:

```javascript
panelTodo_configure({
  projectId: "your-project-id",
  token: "your-auth-token"
})
```

For development mode:
```javascript
panelTodo_configure({
  projectId: "your-project-id",
  devMode: true,
  devUserId: "test-user-id"
})
```

## Resources

The MCP server provides an `instructions` resource with detailed guidelines for AI assistants. Access it at `panel-todo://instructions`.

## Related

- [panel-todo](https://github.com/ingimar-eyfjord/panel-todo) - VS Code extension
- [panel-todo.com](https://panel-todo.com) - Pro subscription
