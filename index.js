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
 *   - panelTodo_complete: Mark a todo as complete
 *   - panelTodo_remove: Remove a todo
 *
 * Issue Tools (Pro - API):
 *   - panelTodo_listIssues: List all issues
 *   - panelTodo_addIssue: Create a new issue
 *   - panelTodo_updateIssue: Update an issue
 *   - panelTodo_completeIssue: Mark issue as done
 *
 * Sprint Tools (Pro - API):
 *   - panelTodo_listSprints: List all sprints
 *   - panelTodo_createSprint: Create a new sprint
 *   - panelTodo_startSprint: Start a sprint
 *   - panelTodo_completeSprint: Complete a sprint
 *   - panelTodo_moveIssueToSprint: Move an issue to a sprint
 *
 * Project Tools (Pro - API):
 *   - panelTodo_listProjects: List all your projects
 *   - panelTodo_switchProject: Switch to a different project
 *   - panelTodo_createProject: Create a new project
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
const DEFAULT_API_URL = 'https://api.paneltodo.com';
const DEV_API_URL = 'http://localhost:3000';

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
 * Make API request to backend
 */
async function apiRequest(path, options = {}) {
  const config = getConfig();
  const apiUrl = getApiUrl();

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
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading todos:', err);
    return [];
  }
}

/**
 * Write todos to project's .vscode folder
 */
function writeTodos(todos) {
  ensureVscodeDir();
  const todoFile = getTodoFile();

  try {
    writeFileSync(todoFile, JSON.stringify(todos, null, 2));
  } catch (err) {
    console.error('Error writing todos:', err);
    throw err;
  }
}

// Initialize MCP server
const server = new McpServer({
  name: 'panel-todo',
  version: '0.1.0',
});

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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, issues: [], count: 0 },
      };
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

// Tool: Add issue
server.registerTool(
  'panelTodo_addIssue',
  {
    title: 'Add Issue',
    description: 'Create a new issue in Panel Todo Pro',
    inputSchema: {
      title: z.string().min(1).describe('Issue title'),
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
  async ({ title, priority = 'medium', status = 'todo', sprintId }) => {
    if (!isProEnabled()) {
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
    }

    const config = getConfig();

    try {
      const body = { title, priority, status };
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

// Tool: Update issue
server.registerTool(
  'panelTodo_updateIssue',
  {
    title: 'Update Issue',
    description: 'Update an existing issue in Panel Todo Pro',
    inputSchema: {
      issueId: z.string().describe('Issue ID to update'),
      title: z.string().optional().describe('New title'),
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().describe('New status'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('New priority'),
      sprintId: z.string().optional().describe('New sprint (empty string to remove from sprint)'),
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
    },
  },
  async ({ issueId, title, status, priority, sprintId }) => {
    if (!isProEnabled()) {
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
    }

    try {
      const updates = {};
      if (title !== undefined) updates.title = title;
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, sprints: [], count: 0 },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, projects: [], currentProjectId: null, count: 0 },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, tags: [], count: 0 },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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
      return {
        content: [{ type: 'text', text: 'Pro not configured. Use panelTodo_configure first.' }],
        structuredContent: { success: false, message: 'Pro not configured' },
      };
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

    const lines = [
      proEnabled
        ? `Pro enabled - Project: ${projectKey ? `${projectKey} (${projectName})` : config.projectId} [source: ${projectIdSource}]`
        : 'Free mode (local todos only)',
      `API: ${apiUrl}`,
      `Todo storage: ${todoFile}`,
    ];

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
