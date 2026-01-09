# Panel Todo MCP Server

MCP (Model Context Protocol) server for Panel Todo, enabling AI assistants to manage todos.

## Installation

```bash
npm install panel-todo-mcp
```

## Usage

Add to your MCP configuration:

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

- `panelTodo_add` - Add a todo
- `panelTodo_list` - List all todos
- `panelTodo_complete` - Complete a todo
- `panelTodo_remove` - Remove a todo

## Related

- [panel-todo](https://github.com/ingimar-eyfjord/panel-todo) - VS Code extension
