#!/usr/bin/env node

/**
 * Panel Todo MCP Server
 *
 * Allows AI assistants like Claude to manage your todo list, issues, and projects
 * via the Model Context Protocol (MCP).
 *
 * Todo Tools (Free - Local Storage):
 *   - panelTodo_add: Add a new todo
 *   - panelTodo_list: List all todos
 *   - panelTodo_update: Update a todo's text
 *   - panelTodo_complete: Mark a todo as complete
 *   - panelTodo_remove: Remove a todo
 *
 * Issue Tools (Pro - API):
 *   - panelTodo_listIssues: List all issues
 *   - panelTodo_searchIssues: Search issues with text query and filters
 *   - panelTodo_getIssue: Get issue by ID or key
 *   - panelTodo_addIssue: Create a new issue
 *   - panelTodo_batchCreateIssues: Create multiple issues at once
 *   - panelTodo_updateIssue: Update an issue
 *   - panelTodo_completeIssue: Mark issue as done
 *   - panelTodo_deleteIssue: Delete an issue
 *
 * Sprint Tools (Pro - API):
 *   - panelTodo_listSprints: List all sprints
 *   - panelTodo_getSprint: Get sprint details with issues
 *   - panelTodo_createSprint: Create a new sprint
 *   - panelTodo_updateSprint: Update sprint name or dates
 *   - panelTodo_startSprint: Start a sprint
 *   - panelTodo_completeSprint: Complete a sprint
 *   - panelTodo_deleteSprint: Delete a sprint
 *   - panelTodo_moveIssueToSprint: Move an issue to a sprint
 *   - panelTodo_getBacklog: Get issues in the backlog
 *
 * Project Tools (Pro - API):
 *   - panelTodo_listProjects: List all your projects
 *   - panelTodo_switchProject: Switch to a different project
 *   - panelTodo_createProject: Create a new project
 *   - panelTodo_deleteProject: Delete a project
 *
 * Tag Tools (Pro - API):
 *   - panelTodo_listTags: List all tags
 *   - panelTodo_createTag: Create a new tag
 *   - panelTodo_updateTag: Update a tag
 *   - panelTodo_deleteTag: Delete a tag
 *   - panelTodo_addTagToIssue: Add tag to issue
 *   - panelTodo_removeTagFromIssue: Remove tag from issue
 *
 * Comment Tools (Pro - API):
 *   - panelTodo_listComments: List comments on an issue
 *   - panelTodo_addComment: Add a comment
 *   - panelTodo_updateComment: Update a comment
 *   - panelTodo_deleteComment: Delete a comment
 *
 * Config Tools:
 *   - panelTodo_configure: Set up Pro connection
 *   - panelTodo_status: Check configuration status
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Pro config storage (global - auth tokens should be user-wide)
const CONFIG_DIR = join(homedir(), '.panel-todo');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Todo storage (per-project - stored in .vscode folder)
// Uses PANEL_TODO_PROJECT_DIR env var, or falls back to cwd
function getProjectDir() {
  return process.env.PANEL_TODO_PROJECT_DIR || process.cwd();
}

function getTodoFile() {
  const projectDir = getProjectDir();
  const vscodeDir = join(projectDir, '.vscode');
  return join(vscodeDir, 'panel-todo.json');
}

function ensureVscodeDir() {
  const vscodeDir = join(getProjectDir(), '.vscode');
  if (!existsSync(vscodeDir)) {
    mkdirSync(vscodeDir, { recursive: true });
  }
}

// API configuration
const DEFAULT_API_URL = 'https://api.panel-todo.com';
const DEV_API_URL = 'http://localhost:3000';

// Pro setup instructions (shown when Pro features are used without configuration)
const PRO_SETUP_MESSAGE = `Panel Todo Pro is not configured.

To use Pro features (issues, sprints, projects), you need:
1. A Panel Todo Pro subscription - sign up at https://panel-todo.com
2. An API token from the VS Code extension

SETUP STEPS:
1. Install the Panel Todo VS Code extension
2. Sign in and subscribe to Pro at https://panel-todo.com
3. In VS Code: Open Panel Todo → Account tab → Create API Token
4. Copy the token (starts with "pt_")
5. Tell me: "Configure Panel Todo with token: pt_YOUR_TOKEN_HERE"

I'll then call panelTodo_configure to set it up.

FREE TIER: You can still use panelTodo_add, panelTodo_list, panelTodo_complete, and panelTodo_remove for local todo management without Pro.`;

/**
 * Helper to create a "Pro not configured" response
 */
function proNotConfiguredResponse(structuredExtra = {}) {
  return {
    content: [{ type: 'text', text: PRO_SETUP_MESSAGE }],
    structuredContent: { success: false, message: 'Pro not configured', ...structuredExtra },
  };
}

/**
 * Get the path to local project config file
 */
function getLocalConfigPath() {
  const projectDir = getProjectDir();
  return join(projectDir, '.vscode', 'panel-todo-config.json');
}

/**
 * Get project ID from local config file (written by extension)
 * Falls back to null if file doesn't exist
 */
function getLocalProjectId() {
  const localConfigPath = getLocalConfigPath();

  if (existsSync(localConfigPath)) {
    try {
      const data = JSON.parse(readFileSync(localConfigPath, 'utf-8'));
      if (data.projectId) return data.projectId;
    } catch {
      // Ignore parse errors
    }
  }
  return null;
}

/**
 * Write project ID to local config file
 * This syncs the project selection with the extension
 */
function setLocalProjectId(projectId) {
  const localConfigPath = getLocalConfigPath();
  const vscodeDir = join(getProjectDir(), '.vscode');

  if (!existsSync(vscodeDir)) {
    mkdirSync(vscodeDir, { recursive: true });
  }

  writeFileSync(localConfigPath, JSON.stringify({ projectId }, null, 2));
}

/**
 * Get API configuration (URL, token, project ID)
 * Project ID is read from local config first (set by extension), then global config
 */
function getConfig() {
  let config = { apiUrl: null, token: null, projectId: null, devMode: false };

  // Read global config (has auth tokens)
  if (existsSync(CONFIG_FILE)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    } catch {
      // Keep default config
    }
  }

  // Override project ID with local config (set by extension)
  const localProjectId = getLocalProjectId();
  if (localProjectId) {
    config.projectId = localProjectId;
  }

  return config;
}

/**
 * Save configuration
 */
function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Check if Pro features are available (has valid config)
 */
function isProEnabled() {
  const config = getConfig();
  return !!(config.projectId && (config.token || config.devMode));
}

/**
 * Get API URL based on config
 */
function getApiUrl() {
  const config = getConfig();
  if (config.devMode) return DEV_API_URL;
  return config.apiUrl || DEFAULT_API_URL;
}

/**
 * Make API request to backend with automatic rate limit handling.
 *
 * Rate Limiting: The backend allows 100 requests per minute per user.
 * If you hit the rate limit (429), this function automatically waits
 * and retries up to 3 times with exponential backoff.
 *
 * Tips to avoid rate limits:
 * - Use bulk operations: panelTodo_batchCreateIssues instead of multiple panelTodo_addIssue
 * - Use panelTodo_searchIssues with filters instead of fetching all + filtering client-side
 * - Cache results when doing read-heavy operations
 */
async function apiRequest(path, options = {}, retryCount = 0) {
  const config = getConfig();
  const apiUrl = getApiUrl();
  const MAX_RETRIES = 3;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add auth header
  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  // Add dev user header for dev mode
  if (config.devMode && config.devUserId) {
    headers['X-Dev-User'] = config.devUserId;
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers,
  });

  // Handle rate limiting (429 Too Many Requests)
  if (response.status === 429 && retryCount < MAX_RETRIES) {
    // Get retry-after header or use exponential backoff
    const retryAfter = response.headers.get('Retry-After');
    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : Math.pow(2, retryCount + 1);
    const waitMs = Math.min(waitSeconds * 1000, 30000); // Max 30 seconds

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, waitMs));

    // Retry the request
    return apiRequest(path, options, retryCount + 1);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }

  return response.json();
}

/**
 * Ensure config directory exists (for Pro settings)
 */
function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Read todos from project's .vscode folder
 */
function readTodos() {
  const todoFile = getTodoFile();

  if (!existsSync(todoFile)) {
    return [];
  }

  try {
    const data = readFileSync(todoFile, 'utf-8');
    const parsed = JSON.parse(data);
    // Handle both formats: flat array or {todos: [...], updatedAt: ...}
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.todos)) {
      return parsed.todos;
    }
    return [];
  } catch (err) {
    console.error('Error reading todos:', err);
    return [];
  }
}

/**
 * Write todos to project's .vscode folder
 * Uses the extension's format: {todos: [...], updatedAt: ...}
 */
function writeTodos(todos) {
  ensureVscodeDir();
  const todoFile = getTodoFile();

  try {
    // Use extension's format for compatibility
    const data = {
      todos,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(todoFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing todos:', err);
    throw err;
  }
}

// Initialize MCP server
const server = new McpServer({
  name: 'panel-todo',
  version: '1.0.0',
  description: `Panel Todo - Persistent task management for AI-assisted coding sessions.

TWO TIERS:
• FREE: Local todos (panelTodo_add/list/complete/remove) - works immediately, no setup needed
• PRO (€4.90/mo): Issues, sprints, projects, tags, comments - requires setup (see below)

PRO SETUP (if user wants Pro features):
1. Subscribe at https://panel-todo.com
2. In VS Code: Panel Todo extension → Account tab → Create API Token
3. User gives you the token (starts with "pt_")
4. Call: panelTodo_configure with projectId and token

CRITICAL FOR AI ASSISTANTS:
You may have your own internal todo/task tracking system - that's fine for your own use.
BUT when Panel Todo MCP is available, ALWAYS ALSO write tasks to Panel Todo because:
1. Tasks persist to disk and survive session restarts
2. The user can see all tasks in VS Code's Panel area
3. Future AI sessions can read these tasks and continue where you left off
4. This maintains context across multiple coding sessions - THE WHOLE POINT

At the START of each session:
1. Call panelTodo_status to check configuration
2. Call panelTodo_listIssues (Pro) or panelTodo_list (Free) to see existing tasks
3. Review in-progress work before starting anything new

During work:
- Create issues/todos for any significant work
- Update status as you progress (todo → in_progress → done)
- Add comments to document decisions and progress (Pro)
- Reference issue keys in commits (e.g., "Fix bug [PROJ-42]")

RATE LIMITING:
- API allows 100 requests/minute (shared across all VS Code windows)
- Automatic retry with backoff on 429 - no manual handling needed
- Use panelTodo_batchCreateIssues for multiple issues (1 request vs N)
- Use panelTodo_searchIssues with filters instead of fetching all + filtering`,
});

// ============================================================================
// LLM INSTRUCTION RESOURCE
// ============================================================================

// Provide clear instructions for AI assistants on how to use Panel Todo
server.registerResource(
  'instructions',
  'panel-todo://instructions',
  {
    title: 'Panel Todo Usage Instructions for AI Assistants',
    description: 'Guidelines for AI assistants on when and how to use Panel Todo',
    mimeType: 'text/markdown',
  },
  async () => {
    return {
      contents: [{
        uri: 'panel-todo://instructions',
        mimeType: 'text/markdown',
        text: `# Panel Todo - AI Assistant Guidelines

## WHY Panel Todo Exists

Panel Todo solves the **context problem** in AI-assisted coding:
- Your internal todo list dies when the session ends
- The user can't see what you're tracking
- The next AI session starts from scratch with no memory

Panel Todo fixes this by:
- Persisting tasks to disk (survives restarts)
- Showing tasks in VS Code's Panel (user visibility)
- Letting future sessions read previous work (context continuity)

## The Golden Rule

**You can use your internal todo system for your own tracking.**
**But ALWAYS ALSO write to Panel Todo when it's available.**

This way:
- You have your internal tracking for the current session
- The user sees progress in VS Code
- Future sessions can pick up where you left off

## Starting Every Session

ALWAYS do this at the start of a coding session:

\`\`\`javascript
// 1. Check what's available
panelTodo_status()

// 2. Read existing work (Pro)
panelTodo_listIssues()
// Or for Free tier:
panelTodo_list()

// 3. Check what's in progress
panelTodo_listIssues({ status: "in_progress" })
\`\`\`

If there are in-progress issues, **ask the user if they want to continue that work** before starting something new.

## During Development

### When user requests work:
\`\`\`javascript
// Create a trackable issue
panelTodo_addIssue({
  title: "Add email validation to signup form",
  priority: "high"
})
// Note the returned key (e.g., "PT-3") for reference
\`\`\`

### As you work:
\`\`\`javascript
// Mark as in progress
panelTodo_updateIssue({ issueId: "<id>", status: "in_progress" })

// Document important decisions
panelTodo_addComment({
  issueId: "<id>",
  content: "Using zod for validation because it integrates with existing form library"
})
\`\`\`

### When done:
\`\`\`javascript
panelTodo_completeIssue({ issueId: "<id>" })
\`\`\`

### In commit messages:
Reference issue keys so they're linked:
- "Add email validation [PT-3]"
- "Fix auth bug (resolves PT-42)"

## Free vs Pro Tier

**FREE (local todos):**
- Stored in project's .vscode folder
- Simple text-based todos
- Good for quick tasks
- Tools: add, list, update, complete, remove

**PRO (cloud issues):**
- Full issue tracking with status/priority
- Sprints for planning
- Tags for categorization
- Comments for context
- Syncs across devices
- Tools: all issue, sprint, project, tag, comment tools

## Best Practices

1. **Be Specific**: "Add email validation to signup form" not "Fix form"

2. **Use Priorities**:
   - critical: Production bugs, blocking issues
   - high: Important features
   - medium: Normal work
   - low: Nice-to-haves

3. **Update Status**: Don't leave issues in "todo" while working on them

4. **Add Comments**: Document WHY decisions were made - future sessions will thank you

5. **Use Tags**: Categorize (bug, feature, refactor) for easy filtering

## Rate Limiting

The API has a rate limit of **100 requests per minute** (shared across all MCP instances and VS Code windows for the same user).

**Automatic retry:** If you hit the rate limit, the MCP will automatically wait and retry up to 3 times with exponential backoff. You don't need to handle 429 errors yourself.

**Best practices to stay within limits:**

1. **Use bulk operations** when creating multiple items:
   \`\`\`javascript
   // GOOD: One request for 10 issues
   panelTodo_batchCreateIssues({ issues: [...tenIssues] })

   // BAD: 10 separate requests
   for (issue of tenIssues) { panelTodo_addIssue(issue) }
   \`\`\`

2. **Use server-side filtering** instead of fetching all + filtering client-side:
   \`\`\`javascript
   // GOOD: Filter on server
   panelTodo_searchIssues({ status: "in_progress", priority: "high" })

   // BAD: Fetch all, filter locally
   const all = panelTodo_listIssues()
   const filtered = all.filter(...)
   \`\`\`

3. **Cache read results** when doing multiple operations:
   \`\`\`javascript
   // GOOD: Fetch once, reference many times
   const issues = panelTodo_listIssues()
   // ... use issues multiple times

   // BAD: Fetch repeatedly
   panelTodo_listIssues() // to count
   panelTodo_listIssues() // to display
   panelTodo_listIssues() // to filter
   \`\`\`

## Tool Quick Reference

| Action | Tool |
|--------|------|
| Check setup | panelTodo_status |
| Add quick todo | panelTodo_add |
| List todos | panelTodo_list |
| Update todo | panelTodo_update |
| Create issue | panelTodo_addIssue |
| **Create many issues** | **panelTodo_batchCreateIssues** |
| List issues | panelTodo_listIssues |
| Search issues | panelTodo_searchIssues |
| Get issue by key | panelTodo_getIssue |
| Update issue | panelTodo_updateIssue |
| Complete issue | panelTodo_completeIssue |
| Delete issue | panelTodo_deleteIssue |
| Add comment | panelTodo_addComment |
| List comments | panelTodo_listComments |
| Update comment | panelTodo_updateComment |
| Delete comment | panelTodo_deleteComment |
| Create tag | panelTodo_createTag |
| Get sprint | panelTodo_getSprint |
| Create sprint | panelTodo_createSprint |
| Update sprint | panelTodo_updateSprint |
| Delete sprint | panelTodo_deleteSprint |
| Move to sprint | panelTodo_moveIssueToSprint |
| Get backlog | panelTodo_getBacklog |
| Delete project | panelTodo_deleteProject |
`
      }],
    };
  }
);

// ============================================================================
// TODO TOOLS (Free - Local Storage)
// ============================================================================

// Tool: Add a new todo
server.registerTool(
  'panelTodo_add',
  {
    title: 'Add Todo',
    description: 'Add a new todo item to Panel Todo (local storage)',
    inputSchema: {
      text: z.string().min(1).describe('The todo text to add'),
    },
    outputSchema: {
      success: z.boolean(),
      todo: z.object({
        id: z.string(),
        text: z.string(),
        createdAt: z.number(),
      }),
    },
  },
  async ({ text }) => {
    const todos = readTodos();

    const todo = {
      id: randomUUID(),
      text: text.trim(),
      createdAt: Date.now(),
    };

    todos.push(todo);
    writeTodos(todos);

    const output = { success: true, todo };
    return {
      content: [{ type: 'text', text: `Added todo: "${todo.text}"` }],
      structuredContent: output,
    };
  }
);

// Tool: List all todos
server.registerTool(
  'panelTodo_list',
  {
    title: 'List Todos',
    description: 'List all current todo items from Panel Todo (local storage)',
    inputSchema: {},
    outputSchema: {
      todos: z.array(z.object({
        id: z.string(),
        text: z.string(),
        createdAt: z.number(),
      })),
      count: z.number(),
    },
  },
  async () => {
    const todos = readTodos();

    const output = { todos, count: todos.length };

    if (todos.length === 0) {
      return {
        content: [{ type: 'text', text: 'No todos found. Your list is empty!' }],
        structuredContent: output,
      };
    }

    const todoList = todos
      .map((t, i) => `${i + 1}. ${t.text}`)
      .join('\n');

    return {
      content: [{ type: 'text', text: `Found ${todos.length} todo(s):\n${todoList}` }],
      structuredContent: output,
    };
  }
);

// Tool: Complete a todo (mark as done and remove)
server.registerTool(
  'panelTodo_complete',
  {
    title: 'Complete Todo',
    description: 'Mark a todo as complete and remove it from the list',
    inputSchema: {
      id: z.string().describe('The todo ID to complete'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ id }) => {
    const todos = readTodos();
    const todoIndex = todos.findIndex(t => t.id === id);

    if (todoIndex === -1) {
      const output = { success: false, message: 'Todo not found' };
      return {
        content: [{ type: 'text', text: `Error: Todo with ID "${id}" not found` }],
        structuredContent: output,
      };
    }

    const [completed] = todos.splice(todoIndex, 1);
    writeTodos(todos);

    const output = { success: true, message: `Completed: "${completed.text}"` };
    return {
      content: [{ type: 'text', text: `Completed todo: "${completed.text}"` }],
      structuredContent: output,
    };
  }
);

// Tool: Remove a todo
server.registerTool(
  'panelTodo_remove',
  {
    title: 'Remove Todo',
    description: 'Remove a todo from the list without completing it',
    inputSchema: {
      id: z.string().describe('The todo ID to remove'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ id }) => {
    const todos = readTodos();
    const todoIndex = todos.findIndex(t => t.id === id);

    if (todoIndex === -1) {
      const output = { success: false, message: 'Todo not found' };
      return {
        content: [{ type: 'text', text: `Error: Todo with ID "${id}" not found` }],
        structuredContent: output,
      };
    }

    const [removed] = todos.splice(todoIndex, 1);
    writeTodos(todos);

    const output = { success: true, message: `Removed: "${removed.text}"` };
    return {
      content: [{ type: 'text', text: `Removed todo: "${removed.text}"` }],
      structuredContent: output,
    };
  }
);

// Tool: Update a todo's text
server.registerTool(
  'panelTodo_update',
  {
    title: 'Update Todo',
    description: 'Update the text of an existing todo item',
    inputSchema: {
      id: z.string().describe('The todo ID to update'),
      text: z.string().min(1).describe('The new todo text'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      todo: z.object({
        id: z.string(),
        text: z.string(),
        createdAt: z.number(),
      }).optional(),
    },
  },
  async ({ id, text }) => {
    const todos = readTodos();
    const todo = todos.find(t => t.id === id);

    if (!todo) {
      const output = { success: false, message: 'Todo not found' };
      return {
        content: [{ type: 'text', text: `Error: Todo with ID "${id}" not found` }],
        structuredContent: output,
      };
    }

    todo.text = text;
    writeTodos(todos);

    const output = { success: true, message: 'Todo updated', todo };
    return {
      content: [{ type: 'text', text: `Updated todo: "${text}"` }],
      structuredContent: output,
    };
  }
);

// ============================================================================
// ISSUE TOOLS (Pro - Backend API)
// ============================================================================

// Tool: Configure Pro connection
server.registerTool(
  'panelTodo_configure',
  {
    title: 'Configure Pro',
    description: 'Configure Panel Todo Pro connection (API URL, token, project)',
    inputSchema: {
      projectId: z.string().describe('The project ID to use'),
      token: z.string().optional().describe('Auth token (optional in dev mode)'),
      devMode: z.boolean().optional().describe('Enable dev mode (localhost API)'),
      devUserId: z.string().optional().describe('Dev user ID for X-Dev-User header'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ projectId, token, devMode, devUserId }) => {
    const config = {
      projectId,
      token: token || null,
      devMode: devMode || false,
      devUserId: devUserId || null,
      apiUrl: DEFAULT_API_URL,
    };

    saveConfig(config);

    return {
      content: [{ type: 'text', text: `Configured Pro: project=${projectId}, devMode=${devMode || false}` }],
      structuredContent: { success: true, message: 'Configuration saved' },
    };
  }
);

// Tool: List issues
server.registerTool(
  'panelTodo_listIssues',
  {
    title: 'List Issues',
    description: 'List all issues from Panel Todo Pro (requires Pro configuration)',
    inputSchema: {
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().describe('Filter by status'),
      sprintId: z.string().optional().describe('Filter by sprint ID'),
    },
    outputSchema: {
      success: z.boolean(),
      issues: z.array(z.object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
        sprint_id: z.string().nullable(),
      })),
      count: z.number(),
    },
  },
  async ({ status, sprintId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse({ issues: [], count: 0 });
    }

    const config = getConfig();

    try {
      const data = await apiRequest(`/v1/projects/${config.projectId}/issues`);
      let issues = data.issues || [];

      // Apply filters
      if (status) {
        issues = issues.filter(i => i.status === status);
      }
      if (sprintId) {
        issues = issues.filter(i => i.sprint_id === sprintId);
      }

      const issueList = issues
        .map(i => `[${i.key}] ${i.title} (${i.status}, ${i.priority})`)
        .join('\n');

      return {
        content: [{ type: 'text', text: issues.length > 0 ? `Found ${issues.length} issue(s):\n${issueList}` : 'No issues found.' }],
        structuredContent: { success: true, issues, count: issues.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching issues: ${err.message}` }],
        structuredContent: { success: false, issues: [], count: 0 },
      };
    }
  }
);

// Tool: Search issues
server.registerTool(
  'panelTodo_searchIssues',
  {
    title: 'Search Issues',
    description: 'Search issues with text query and filters. More powerful than listIssues for finding specific issues.',
    inputSchema: {
      query: z.string().max(200).optional().describe('Text to search in title and description'),
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().describe('Filter by status'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by priority'),
      sprintId: z.string().optional().describe('Filter by sprint ID'),
      tagIds: z.array(z.string()).optional().describe('Filter by tag IDs (issues with any of these tags)'),
      limit: z.number().max(100).optional().describe('Max results (default 100)'),
    },
    outputSchema: {
      success: z.boolean(),
      issues: z.array(z.object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
      })),
      count: z.number(),
    },
  },
  async ({ query, status, priority, sprintId, tagIds, limit }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse({ issues: [], count: 0 });
    }

    const config = getConfig();

    try {
      // Build query params
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (status) params.append('status', status);
      if (priority) params.append('priority', priority);
      if (sprintId) params.append('sprintId', sprintId);
      if (tagIds && tagIds.length > 0) params.append('tagIds', tagIds.join(','));
      if (limit) params.append('limit', String(limit));

      const queryString = params.toString();
      const url = `/v1/projects/${config.projectId}/issues${queryString ? `?${queryString}` : ''}`;

      const data = await apiRequest(url);
      const issues = data.issues || [];

      const issueList = issues
        .map(i => `[${i.key}] ${i.title} (${i.status}, ${i.priority})`)
        .join('\n');

      return {
        content: [{ type: 'text', text: issues.length > 0 ? `Found ${issues.length} issue(s):\n${issueList}` : 'No matching issues found.' }],
        structuredContent: { success: true, issues, count: issues.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error searching issues: ${err.message}` }],
        structuredContent: { success: false, issues: [], count: 0 },
      };
    }
  }
);

// Tool: Add issue
server.registerTool(
  'panelTodo_addIssue',
  {
    title: 'Add Issue',
    description: 'Create a new issue in Panel Todo Pro. For sprint planning, include a description with: (1) implementation approach, (2) key tasks/steps, and (3) acceptance criteria.',
    inputSchema: {
      title: z.string().min(1).describe('Issue title'),
      description: z.string().max(10000).optional().describe('Issue description with implementation details, approach, and acceptance criteria (supports markdown)'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority level'),
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().describe('Initial status'),
      sprintId: z.string().optional().describe('Sprint to assign to'),
    },
    outputSchema: {
      success: z.boolean(),
      issue: z.object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
      }).optional(),
      message: z.string(),
    },
  },
  async ({ title, description, priority = 'medium', status = 'todo', sprintId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    const config = getConfig();

    try {
      const body = { title, priority, status };
      if (description) body.description = description;
      if (sprintId) body.sprintId = sprintId;

      const issue = await apiRequest(`/v1/projects/${config.projectId}/issues`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return {
        content: [{ type: 'text', text: `Created issue: [${issue.key}] ${issue.title}` }],
        structuredContent: { success: true, issue, message: 'Issue created' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error creating issue: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Batch create issues
server.registerTool(
  'panelTodo_batchCreateIssues',
  {
    title: 'Batch Create Issues',
    description: 'Create multiple issues at once. Useful for sprint planning when creating many related issues.',
    inputSchema: {
      issues: z.array(z.object({
        title: z.string().min(1).describe('Issue title'),
        description: z.string().max(10000).optional().describe('Issue description'),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority level'),
        status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().describe('Initial status'),
      })).min(1).max(50).describe('Issues to create (max 50)'),
      sprintId: z.string().optional().describe('Assign all issues to this sprint'),
    },
    outputSchema: {
      success: z.boolean(),
      issues: z.array(z.object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
      })),
      count: z.number(),
      message: z.string(),
    },
  },
  async ({ issues, sprintId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse({ issues: [], count: 0 });
    }

    const config = getConfig();

    try {
      const body = { issues };
      if (sprintId) body.sprintId = sprintId;

      const data = await apiRequest(`/v1/projects/${config.projectId}/issues/batch`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const created = data.issues || [];
      const issueList = created
        .map(i => `[${i.key}] ${i.title}`)
        .join('\n');

      return {
        content: [{ type: 'text', text: `Created ${created.length} issue(s):\n${issueList}` }],
        structuredContent: { success: true, issues: created, count: created.length, message: 'Issues created' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error creating issues: ${err.message}` }],
        structuredContent: { success: false, issues: [], count: 0, message: err.message },
      };
    }
  }
);

// Tool: Update issue
server.registerTool(
  'panelTodo_updateIssue',
  {
    title: 'Update Issue',
    description: 'Update an existing issue in Panel Todo Pro',
    inputSchema: {
      issueId: z.string().describe('Issue ID to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().max(10000).optional().describe('New description (supports markdown)'),
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().describe('New status'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('New priority'),
      sprintId: z.string().optional().describe('New sprint (empty string to remove from sprint)'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ issueId, title, description, status, priority, sprintId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      const updates = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (status !== undefined) updates.status = status;
      if (priority !== undefined) updates.priority = priority;
      if (sprintId !== undefined) updates.sprintId = sprintId || null;

      await apiRequest(`/v1/issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      return {
        content: [{ type: 'text', text: `Updated issue ${issueId}` }],
        structuredContent: { success: true, message: 'Issue updated' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error updating issue: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Complete issue (mark as done)
server.registerTool(
  'panelTodo_completeIssue',
  {
    title: 'Complete Issue',
    description: 'Mark an issue as done in Panel Todo Pro',
    inputSchema: {
      issueId: z.string().describe('Issue ID to complete'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ issueId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
      });

      return {
        content: [{ type: 'text', text: `Completed issue ${issueId}` }],
        structuredContent: { success: true, message: 'Issue marked as done' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error completing issue: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Delete issue
server.registerTool(
  'panelTodo_deleteIssue',
  {
    title: 'Delete Issue',
    description: 'Permanently delete an issue from Panel Todo Pro',
    inputSchema: {
      issueId: z.string().describe('Issue ID to delete'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ issueId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/issues/${issueId}`, {
        method: 'DELETE',
      });

      return {
        content: [{ type: 'text', text: `Deleted issue ${issueId}` }],
        structuredContent: { success: true, message: 'Issue deleted' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting issue: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Get single issue by ID or key
server.registerTool(
  'panelTodo_getIssue',
  {
    title: 'Get Issue',
    description: 'Get details of a specific issue by ID or key (e.g., "PT-1")',
    inputSchema: {
      issueId: z.string().optional().describe('Issue ID (UUID)'),
      key: z.string().optional().describe('Issue key (e.g., "PT-1", "WORK-42")'),
    },
    outputSchema: {
      success: z.boolean(),
      issue: z.object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
      }).optional(),
      message: z.string().optional(),
    },
  },
  async ({ issueId, key }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    if (!issueId && !key) {
      return {
        content: [{ type: 'text', text: 'Either issueId or key is required' }],
        structuredContent: { success: false, message: 'Either issueId or key is required' },
      };
    }

    const config = getConfig();

    try {
      // If key is provided, search for the issue
      if (key && !issueId) {
        const data = await apiRequest(`/v1/projects/${config.projectId}/issues`);
        const issue = (data.issues || []).find(i => i.key.toLowerCase() === key.toLowerCase());
        if (!issue) {
          return {
            content: [{ type: 'text', text: `Issue with key "${key}" not found` }],
            structuredContent: { success: false, message: 'Issue not found' },
          };
        }
        return {
          content: [{ type: 'text', text: `Found issue: [${issue.key}] ${issue.title} (${issue.status})` }],
          structuredContent: { success: true, issue },
        };
      }

      // Get by ID
      const issue = await apiRequest(`/v1/issues/${issueId}`);
      return {
        content: [{ type: 'text', text: `Found issue: [${issue.key}] ${issue.title} (${issue.status})` }],
        structuredContent: { success: true, issue },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error getting issue: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: List sprints
server.registerTool(
  'panelTodo_listSprints',
  {
    title: 'List Sprints',
    description: 'List all sprints from Panel Todo Pro',
    inputSchema: {
      status: z.enum(['planning', 'active', 'completed']).optional().describe('Filter by sprint status'),
    },
    outputSchema: {
      success: z.boolean(),
      sprints: z.array(z.object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
      })),
      count: z.number(),
    },
  },
  async ({ status }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse({ sprints: [], count: 0 });
    }

    const config = getConfig();

    try {
      const data = await apiRequest(`/v1/projects/${config.projectId}/sprints`);
      let sprints = data.sprints || [];

      if (status) {
        sprints = sprints.filter(s => s.status === status);
      }

      const sprintList = sprints
        .map(s => `${s.name} (${s.status})`)
        .join('\n');

      return {
        content: [{ type: 'text', text: sprints.length > 0 ? `Found ${sprints.length} sprint(s):\n${sprintList}` : 'No sprints found.' }],
        structuredContent: { success: true, sprints, count: sprints.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching sprints: ${err.message}` }],
        structuredContent: { success: false, sprints: [], count: 0 },
      };
    }
  }
);

// Tool: Get sprint details
server.registerTool(
  'panelTodo_getSprint',
  {
    title: 'Get Sprint',
    description: 'Get details of a specific sprint including its issues',
    inputSchema: {
      sprintId: z.string().describe('Sprint ID to get'),
    },
    outputSchema: {
      success: z.boolean(),
      sprint: z.object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
        start_date: z.string().nullable(),
        end_date: z.string().nullable(),
        issues: z.array(z.object({
          id: z.string(),
          key: z.string(),
          title: z.string(),
          status: z.string(),
        })),
      }).optional(),
      message: z.string().optional(),
    },
  },
  async ({ sprintId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      const sprint = await apiRequest(`/v1/sprints/${sprintId}`);

      return {
        content: [{ type: 'text', text: `Sprint: ${sprint.name} (${sprint.status}) - ${sprint.issues?.length || 0} issues` }],
        structuredContent: { success: true, sprint },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error getting sprint: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Create sprint
server.registerTool(
  'panelTodo_createSprint',
  {
    title: 'Create Sprint',
    description: 'Create a new sprint in Panel Todo Pro',
    inputSchema: {
      name: z.string().min(1).max(100).describe('Sprint name'),
      startDate: z.string().optional().describe('Start date (ISO format, e.g., 2024-01-15)'),
      endDate: z.string().optional().describe('End date (ISO format, e.g., 2024-01-29)'),
    },
    outputSchema: {
      success: z.boolean(),
      sprint: z.object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
      }).optional(),
      message: z.string(),
    },
  },
  async ({ name, startDate, endDate }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    const config = getConfig();

    try {
      const body = { name };
      if (startDate) body.startDate = new Date(startDate).toISOString();
      if (endDate) body.endDate = new Date(endDate).toISOString();

      const sprint = await apiRequest(`/v1/projects/${config.projectId}/sprints`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return {
        content: [{ type: 'text', text: `Created sprint: ${sprint.name} (${sprint.status})` }],
        structuredContent: { success: true, sprint, message: 'Sprint created' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error creating sprint: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Start sprint
server.registerTool(
  'panelTodo_startSprint',
  {
    title: 'Start Sprint',
    description: 'Start a sprint (change status from planning to active)',
    inputSchema: {
      sprintId: z.string().describe('Sprint ID to start'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ sprintId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/sprints/${sprintId}/start`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      return {
        content: [{ type: 'text', text: `Sprint ${sprintId} started` }],
        structuredContent: { success: true, message: 'Sprint started' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error starting sprint: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Complete sprint
server.registerTool(
  'panelTodo_completeSprint',
  {
    title: 'Complete Sprint',
    description: 'Complete a sprint and optionally move incomplete issues to backlog',
    inputSchema: {
      sprintId: z.string().describe('Sprint ID to complete'),
      moveIncomplete: z.boolean().optional().describe('Move incomplete issues to backlog (default: true)'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ sprintId, moveIncomplete = true }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/sprints/${sprintId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ moveIncomplete }),
      });

      return {
        content: [{ type: 'text', text: `Sprint ${sprintId} completed` }],
        structuredContent: { success: true, message: 'Sprint completed' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error completing sprint: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Delete sprint
server.registerTool(
  'panelTodo_deleteSprint',
  {
    title: 'Delete Sprint',
    description: 'Delete a sprint. Cannot delete the default Backlog sprint.',
    inputSchema: {
      sprintId: z.string().describe('Sprint ID to delete'),
      moveToBacklog: z.boolean().optional().describe('Move issues to backlog before deleting (default: true)'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ sprintId, moveToBacklog = true }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/sprints/${sprintId}?moveToBacklog=${moveToBacklog}`, {
        method: 'DELETE',
      });

      return {
        content: [{ type: 'text', text: `Sprint ${sprintId} deleted` }],
        structuredContent: { success: true, message: 'Sprint deleted' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting sprint: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Update sprint
server.registerTool(
  'panelTodo_updateSprint',
  {
    title: 'Update Sprint',
    description: 'Update an existing sprint name or dates',
    inputSchema: {
      sprintId: z.string().describe('Sprint ID to update'),
      name: z.string().min(1).max(100).optional().describe('New sprint name'),
      startDate: z.string().optional().describe('New start date (ISO format, e.g., 2024-01-15)'),
      endDate: z.string().optional().describe('New end date (ISO format, e.g., 2024-01-29)'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      sprint: z.object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
      }).optional(),
    },
  },
  async ({ sprintId, name, startDate, endDate }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      const body = {};
      if (name !== undefined) body.name = name;
      if (startDate !== undefined) body.startDate = new Date(startDate).toISOString();
      if (endDate !== undefined) body.endDate = new Date(endDate).toISOString();

      const sprint = await apiRequest(`/v1/sprints/${sprintId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      return {
        content: [{ type: 'text', text: `Updated sprint: ${sprint.name}` }],
        structuredContent: { success: true, message: 'Sprint updated', sprint },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error updating sprint: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Move issue to sprint
server.registerTool(
  'panelTodo_moveIssueToSprint',
  {
    title: 'Move Issue to Sprint',
    description: 'Move an issue to a specific sprint',
    inputSchema: {
      issueId: z.string().describe('Issue ID to move'),
      sprintId: z.string().describe('Sprint ID to move the issue to'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ issueId, sprintId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/sprints/${sprintId}/issues`, {
        method: 'POST',
        body: JSON.stringify({ issueId }),
      });

      return {
        content: [{ type: 'text', text: `Moved issue ${issueId} to sprint ${sprintId}` }],
        structuredContent: { success: true, message: 'Issue moved to sprint' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error moving issue: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Get backlog issues
server.registerTool(
  'panelTodo_getBacklog',
  {
    title: 'Get Backlog',
    description: 'List issues not assigned to any active sprint (backlog items)',
    inputSchema: {
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().describe('Filter by status'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by priority'),
    },
    outputSchema: {
      success: z.boolean(),
      issues: z.array(z.object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
      })),
      count: z.number(),
    },
  },
  async ({ status, priority }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse({ issues: [], count: 0 });
    }

    const config = getConfig();

    try {
      // First, get all sprints to find the default Backlog sprint
      const sprintsData = await apiRequest(`/v1/projects/${config.projectId}/sprints`);
      const sprints = sprintsData.sprints || [];
      const backlogSprint = sprints.find(s => s.is_default);

      // Get all issues in the project
      const data = await apiRequest(`/v1/projects/${config.projectId}/issues`);
      let issues = data.issues || [];

      // Filter for backlog issues (either in default sprint or no sprint)
      if (backlogSprint) {
        issues = issues.filter(i => i.sprint_id === backlogSprint.id);
      } else {
        issues = issues.filter(i => !i.sprint_id);
      }

      // Apply additional filters
      if (status) issues = issues.filter(i => i.status === status);
      if (priority) issues = issues.filter(i => i.priority === priority);

      const issueList = issues
        .map(i => `[${i.key}] ${i.title} (${i.status}, ${i.priority})`)
        .join('\n');

      return {
        content: [{ type: 'text', text: issues.length > 0 ? `Backlog (${issues.length} issue(s)):\n${issueList}` : 'Backlog is empty.' }],
        structuredContent: { success: true, issues, count: issues.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching backlog: ${err.message}` }],
        structuredContent: { success: false, issues: [], count: 0 },
      };
    }
  }
);

// ============================================================================
// PROJECT TOOLS (Pro - Backend API)
// ============================================================================

// Tool: List projects
server.registerTool(
  'panelTodo_listProjects',
  {
    title: 'List Projects',
    description: 'List all your Panel Todo Pro projects',
    inputSchema: {},
    outputSchema: {
      success: z.boolean(),
      projects: z.array(z.object({
        id: z.string(),
        name: z.string(),
        key: z.string(),
        description: z.string().nullable(),
      })),
      currentProjectId: z.string().nullable(),
      count: z.number(),
    },
  },
  async () => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse({ projects: [], currentProjectId: null, count: 0 });
    }

    try {
      const data = await apiRequest('/v1/projects');
      const projects = data.projects || [];
      const config = getConfig();

      const projectList = projects
        .map(p => `${p.key}: ${p.name}${p.id === config.projectId ? ' (current)' : ''}`)
        .join('\n');

      return {
        content: [{ type: 'text', text: projects.length > 0 ? `Found ${projects.length} project(s):\n${projectList}` : 'No projects found.' }],
        structuredContent: { success: true, projects, currentProjectId: config.projectId, count: projects.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching projects: ${err.message}` }],
        structuredContent: { success: false, projects: [], currentProjectId: null, count: 0 },
      };
    }
  }
);

// Tool: Switch project
server.registerTool(
  'panelTodo_switchProject',
  {
    title: 'Switch Project',
    description: 'Switch to a different Panel Todo Pro project',
    inputSchema: {
      projectId: z.string().describe('Project ID to switch to'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      project: z.object({
        id: z.string(),
        name: z.string(),
        key: z.string(),
      }).optional(),
    },
  },
  async ({ projectId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      // Verify project exists and user has access
      const data = await apiRequest(`/v1/projects/${projectId}`);

      // Update local config (syncs with extension)
      setLocalProjectId(projectId);

      // Also update global config as fallback
      const config = getConfig();
      config.projectId = projectId;
      saveConfig(config);

      return {
        content: [{ type: 'text', text: `Switched to project: ${data.key} - ${data.name}` }],
        structuredContent: { success: true, message: 'Project switched', project: data },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error switching project: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Create project
server.registerTool(
  'panelTodo_createProject',
  {
    title: 'Create Project',
    description: 'Create a new Panel Todo Pro project',
    inputSchema: {
      name: z.string().min(1).max(100).describe('Project name'),
      key: z.string().min(1).max(10).describe('Project key (e.g., PT, WORK, HOME) - used for issue prefixes'),
      description: z.string().max(1000).optional().describe('Project description'),
      switchTo: z.boolean().optional().describe('Switch to this project after creating (default: true)'),
    },
    outputSchema: {
      success: z.boolean(),
      project: z.object({
        id: z.string(),
        name: z.string(),
        key: z.string(),
      }).optional(),
      message: z.string(),
    },
  },
  async ({ name, key, description, switchTo = true }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      const project = await apiRequest('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name, key: key.toUpperCase(), description }),
      });

      // Optionally switch to the new project
      if (switchTo) {
        // Update local config (syncs with extension)
        setLocalProjectId(project.id);

        // Also update global config as fallback
        const config = getConfig();
        config.projectId = project.id;
        saveConfig(config);
      }

      return {
        content: [{ type: 'text', text: `Created project: ${project.key} - ${project.name}${switchTo ? ' (now active)' : ''}` }],
        structuredContent: { success: true, project, message: 'Project created' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error creating project: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Delete project
server.registerTool(
  'panelTodo_deleteProject',
  {
    title: 'Delete Project',
    description: 'Permanently delete a project and all its issues, sprints, and tags. This action cannot be undone.',
    inputSchema: {
      projectId: z.string().describe('Project ID to delete'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ projectId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/projects/${projectId}`, {
        method: 'DELETE',
      });

      // If the deleted project was the current one, clear the config
      const config = getConfig();
      if (config.projectId === projectId) {
        config.projectId = null;
        saveConfig(config);
      }

      return {
        content: [{ type: 'text', text: `Project ${projectId} deleted` }],
        structuredContent: { success: true, message: 'Project deleted' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting project: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// ============================================================================
// TAG TOOLS (Pro - Backend API)
// ============================================================================

// Tool: List tags
server.registerTool(
  'panelTodo_listTags',
  {
    title: 'List Tags',
    description: 'List all tags for the current project',
    inputSchema: {},
    outputSchema: {
      success: z.boolean(),
      tags: z.array(z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
      })),
      count: z.number(),
    },
  },
  async () => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse({ tags: [], count: 0 });
    }

    try {
      const config = getConfig();
      const data = await apiRequest(`/v1/projects/${config.projectId}/tags`);
      const tags = data.tags || [];

      const tagList = tags.length
        ? tags.map(t => `• ${t.name} (${t.color})`).join('\n')
        : 'No tags in this project';

      return {
        content: [{ type: 'text', text: `Tags:\n${tagList}` }],
        structuredContent: { success: true, tags, count: tags.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching tags: ${err.message}` }],
        structuredContent: { success: false, tags: [], count: 0 },
      };
    }
  }
);

// Tool: Create tag
server.registerTool(
  'panelTodo_createTag',
  {
    title: 'Create Tag',
    description: 'Create a new tag in the current project',
    inputSchema: {
      name: z.string().min(1).max(50).describe('Tag name'),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).describe('Hex color (e.g., #FF5733)'),
    },
    outputSchema: {
      success: z.boolean(),
      tag: z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
      }).optional(),
      message: z.string(),
    },
  },
  async ({ name, color }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      const config = getConfig();
      const tag = await apiRequest(`/v1/projects/${config.projectId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ name, color }),
      });

      return {
        content: [{ type: 'text', text: `Created tag: ${tag.name} (${tag.color})` }],
        structuredContent: { success: true, tag, message: 'Tag created' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error creating tag: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Update tag
server.registerTool(
  'panelTodo_updateTag',
  {
    title: 'Update Tag',
    description: 'Update an existing tag name or color',
    inputSchema: {
      tagId: z.string().describe('Tag ID to update'),
      name: z.string().min(1).max(50).optional().describe('New tag name'),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('New hex color'),
    },
    outputSchema: {
      success: z.boolean(),
      tag: z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
      }).optional(),
      message: z.string(),
    },
  },
  async ({ tagId, name, color }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      const body = {};
      if (name) body.name = name;
      if (color) body.color = color;

      const tag = await apiRequest(`/v1/tags/${tagId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      return {
        content: [{ type: 'text', text: `Updated tag: ${tag.name} (${tag.color})` }],
        structuredContent: { success: true, tag, message: 'Tag updated' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error updating tag: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Delete tag
server.registerTool(
  'panelTodo_deleteTag',
  {
    title: 'Delete Tag',
    description: 'Delete a tag from the project',
    inputSchema: {
      tagId: z.string().describe('Tag ID to delete'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ tagId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/tags/${tagId}`, {
        method: 'DELETE',
      });

      return {
        content: [{ type: 'text', text: `Tag ${tagId} deleted` }],
        structuredContent: { success: true, message: 'Tag deleted' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting tag: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Add tag to issue
server.registerTool(
  'panelTodo_addTagToIssue',
  {
    title: 'Add Tag to Issue',
    description: 'Add a tag to an issue',
    inputSchema: {
      issueId: z.string().describe('Issue ID'),
      tagId: z.string().describe('Tag ID to add'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ issueId, tagId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/issues/${issueId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId }),
      });

      return {
        content: [{ type: 'text', text: `Tag added to issue ${issueId}` }],
        structuredContent: { success: true, message: 'Tag added to issue' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error adding tag: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Remove tag from issue
server.registerTool(
  'panelTodo_removeTagFromIssue',
  {
    title: 'Remove Tag from Issue',
    description: 'Remove a tag from an issue',
    inputSchema: {
      issueId: z.string().describe('Issue ID'),
      tagId: z.string().describe('Tag ID to remove'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ issueId, tagId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/issues/${issueId}/tags/${tagId}`, {
        method: 'DELETE',
      });

      return {
        content: [{ type: 'text', text: `Tag removed from issue ${issueId}` }],
        structuredContent: { success: true, message: 'Tag removed from issue' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error removing tag: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// ============================================================================
// COMMENT TOOLS (Pro - Backend API)
// ============================================================================

// Tool: List comments on an issue
server.registerTool(
  'panelTodo_listComments',
  {
    title: 'List Comments',
    description: 'List all comments on an issue',
    inputSchema: {
      issueId: z.string().describe('Issue ID to get comments for'),
    },
    outputSchema: {
      success: z.boolean(),
      comments: z.array(z.object({
        id: z.string(),
        content: z.string(),
        created_at: z.string(),
      })),
      count: z.number(),
    },
  },
  async ({ issueId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse({ comments: [], count: 0 });
    }

    try {
      const data = await apiRequest(`/v1/issues/${issueId}/comments`);
      const comments = data.comments || [];

      const text = comments.length > 0
        ? `${comments.length} comment(s):\n${comments.map(c => `- ${c.content}`).join('\n')}`
        : 'No comments on this issue';

      return {
        content: [{ type: 'text', text }],
        structuredContent: { success: true, comments, count: comments.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error listing comments: ${err.message}` }],
        structuredContent: { success: false, comments: [], count: 0 },
      };
    }
  }
);

// Tool: Add comment to an issue
server.registerTool(
  'panelTodo_addComment',
  {
    title: 'Add Comment',
    description: 'Add a comment to an issue',
    inputSchema: {
      issueId: z.string().describe('Issue ID to comment on'),
      content: z.string().min(1).describe('Comment text'),
    },
    outputSchema: {
      success: z.boolean(),
      comment: z.object({
        id: z.string(),
        content: z.string(),
        created_at: z.string(),
      }).optional(),
      message: z.string(),
    },
  },
  async ({ issueId, content }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      const comment = await apiRequest(`/v1/issues/${issueId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });

      return {
        content: [{ type: 'text', text: `Comment added to issue` }],
        structuredContent: { success: true, comment, message: 'Comment added' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error adding comment: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Update comment
server.registerTool(
  'panelTodo_updateComment',
  {
    title: 'Update Comment',
    description: 'Update the content of an existing comment. You can only update your own comments.',
    inputSchema: {
      issueId: z.string().describe('Issue ID the comment belongs to'),
      commentId: z.string().describe('Comment ID to update'),
      content: z.string().min(1).describe('New comment text'),
    },
    outputSchema: {
      success: z.boolean(),
      comment: z.object({
        id: z.string(),
        content: z.string(),
        updated_at: z.string(),
      }).optional(),
      message: z.string(),
    },
  },
  async ({ issueId, commentId, content }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      const comment = await apiRequest(`/v1/issues/${issueId}/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      });

      return {
        content: [{ type: 'text', text: `Comment updated` }],
        structuredContent: { success: true, comment, message: 'Comment updated' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error updating comment: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// Tool: Delete comment
server.registerTool(
  'panelTodo_deleteComment',
  {
    title: 'Delete Comment',
    description: 'Delete a comment from an issue. You can only delete your own comments.',
    inputSchema: {
      issueId: z.string().describe('Issue ID the comment belongs to'),
      commentId: z.string().describe('Comment ID to delete'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ issueId, commentId }) => {
    if (!isProEnabled()) {
      return proNotConfiguredResponse();
    }

    try {
      await apiRequest(`/v1/issues/${issueId}/comments/${commentId}`, {
        method: 'DELETE',
      });

      return {
        content: [{ type: 'text', text: `Comment deleted` }],
        structuredContent: { success: true, message: 'Comment deleted' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting comment: ${err.message}` }],
        structuredContent: { success: false, message: err.message },
      };
    }
  }
);

// ============================================================================
// STATUS & CONFIG TOOLS
// ============================================================================

// Tool: Get Pro status
server.registerTool(
  'panelTodo_status',
  {
    title: 'Check Status',
    description: 'Check Panel Todo configuration and Pro status',
    inputSchema: {},
    outputSchema: {
      proEnabled: z.boolean(),
      projectId: z.string().nullable(),
      projectName: z.string().nullable(),
      projectKey: z.string().nullable(),
      devMode: z.boolean(),
      apiUrl: z.string(),
      todoStorage: z.string(),
    },
  },
  async () => {
    const config = getConfig();
    const proEnabled = isProEnabled();
    const apiUrl = getApiUrl();
    const todoFile = getTodoFile();
    const localProjectId = getLocalProjectId();
    const projectIdSource = localProjectId ? 'extension' : (config.projectId ? 'global config' : 'none');

    // Try to get project details if Pro is enabled
    let projectName = null;
    let projectKey = null;
    if (proEnabled && config.projectId) {
      try {
        const project = await apiRequest(`/v1/projects/${config.projectId}`);
        projectName = project.name;
        projectKey = project.key;
      } catch {
        // Project may not exist or API error
      }
    }

    const lines = [];

    if (proEnabled) {
      lines.push(`✓ Pro enabled - Project: ${projectKey ? `${projectKey} (${projectName})` : config.projectId}`);
      lines.push(`  API: ${apiUrl}`);
      lines.push(`  Todo storage: ${todoFile}`);
      lines.push('');
      lines.push('Available: All Pro features (issues, sprints, projects, tags, comments)');
    } else {
      lines.push('○ Free mode (local todos only)');
      lines.push(`  Todo storage: ${todoFile}`);
      lines.push('');
      lines.push('Available: panelTodo_add, panelTodo_list, panelTodo_complete, panelTodo_remove');
      lines.push('');
      lines.push('TO ENABLE PRO FEATURES:');
      lines.push('1. User subscribes at https://panel-todo.com');
      lines.push('2. User creates API token in VS Code: Panel Todo → Account → Create API Token');
      lines.push('3. User shares the token (starts with "pt_")');
      lines.push('4. You call: panelTodo_configure({ projectId: "...", token: "pt_..." })');
      lines.push('');
      lines.push('Pro features: Issues with status/priority, sprints, projects, tags, comments, cloud sync');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: {
        proEnabled,
        projectId: config.projectId || null,
        projectName,
        projectKey,
        projectIdSource,
        devMode: config.devMode || false,
        apiUrl,
        todoStorage: todoFile,
      },
    };
  }
);

// Connect to stdio transport and start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep process alive
  process.stdin.resume();
}

main().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
