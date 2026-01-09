# Panel Todo MCP Server

MCP (Model Context Protocol) server for Panel Todo, enabling AI assistants to manage todos and issues.

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
      "args": ["panel-todo-mcp"]
    }
  }
}
```

## Available Tools

### Free Tier (Local Storage)

| Tool | Description |
|------|-------------|
| `panelTodo_add` | Add a new todo |
| `panelTodo_list` | List all todos |
| `panelTodo_complete` | Mark a todo as complete |
| `panelTodo_remove` | Remove a todo |

### Pro Tier (Cloud Sync)

**Configuration:**
| Tool | Description |
|------|-------------|
| `panelTodo_configure` | Set up Pro connection (API URL, token, project) |
| `panelTodo_status` | Check configuration and Pro status |

**Issues:**
| Tool | Description |
|------|-------------|
| `panelTodo_listIssues` | List all issues (filter by status/sprint) |
| `panelTodo_addIssue` | Create a new issue |
| `panelTodo_updateIssue` | Update an existing issue |
| `panelTodo_completeIssue` | Mark an issue as done |

**Sprints:**
| Tool | Description |
|------|-------------|
| `panelTodo_listSprints` | List all sprints |
| `panelTodo_createSprint` | Create a new sprint |
| `panelTodo_startSprint` | Start a sprint (planning -> active) |
| `panelTodo_completeSprint` | Complete a sprint |
| `panelTodo_moveIssueToSprint` | Move an issue to a sprint |

**Projects:**
| Tool | Description |
|------|-------------|
| `panelTodo_listProjects` | List all your projects |
| `panelTodo_switchProject` | Switch to a different project |
| `panelTodo_createProject` | Create a new project |

**Tags:**
| Tool | Description |
|------|-------------|
| `panelTodo_listTags` | List all tags for the current project |
| `panelTodo_createTag` | Create a new tag |
| `panelTodo_updateTag` | Update a tag's name or color |
| `panelTodo_deleteTag` | Delete a tag |
| `panelTodo_addTagToIssue` | Add a tag to an issue |
| `panelTodo_removeTagFromIssue` | Remove a tag from an issue |

## Pro Configuration

To use Pro features, configure the MCP server:

```
panelTodo_configure({
  projectId: "your-project-id",
  token: "your-auth-token"
})
```

For development mode:
```
panelTodo_configure({
  projectId: "your-project-id",
  devMode: true,
  devUserId: "test-user-id"
})
```

## Related

- [panel-todo](https://github.com/ingimar-eyfjord/panel-todo) - VS Code extension
- [paneltodo.com](https://paneltodo.com) - Pro subscription
