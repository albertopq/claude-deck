import { getPool } from "./index";
import type {
  Session,
  Group,
  Project,
  ProjectDevServer,
  ProjectRepository,
  DevServer,
} from "./types";

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows;
}

async function queryOne<T>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await getPool().query(sql, params);
}

export const queries = {
  createSession: (
    id: string,
    name: string,
    tmuxName: string | null,
    workingDirectory: string,
    parentSessionId: string | null,
    model: string | null,
    systemPrompt: string | null,
    groupPath: string,
    agentType: string,
    autoApprove: boolean,
    projectId: string | null
  ) =>
    execute(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, parent_session_id, model, system_prompt, group_path, agent_type, auto_approve, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        name,
        tmuxName,
        workingDirectory,
        parentSessionId,
        model,
        systemPrompt,
        groupPath,
        agentType,
        autoApprove,
        projectId,
      ]
    ),

  getSession: (id: string) =>
    queryOne<Session>(`SELECT * FROM sessions WHERE id = $1`, [id]),

  getAllSessions: () =>
    query<Session>(`SELECT * FROM sessions ORDER BY updated_at DESC`),

  updateSessionStatus: (status: string, id: string) =>
    execute(
      `UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id]
    ),

  updateSessionClaudeId: (claudeSessionId: string, id: string) =>
    execute(
      `UPDATE sessions SET claude_session_id = $1, updated_at = NOW() WHERE id = $2`,
      [claudeSessionId, id]
    ),

  updateSessionName: (name: string, tmuxName: string, id: string) =>
    execute(
      `UPDATE sessions SET name = $1, tmux_name = $2, updated_at = NOW() WHERE id = $3`,
      [name, tmuxName, id]
    ),

  deleteSession: (id: string) =>
    execute(`DELETE FROM sessions WHERE id = $1`, [id]),

  updateSessionWorktree: (
    worktreePath: string | null,
    branchName: string | null,
    baseBranch: string | null,
    port: number | null,
    id: string
  ) =>
    execute(
      `UPDATE sessions SET worktree_path = $1, branch_name = $2, base_branch = $3, dev_server_port = $4, updated_at = NOW() WHERE id = $5`,
      [worktreePath, branchName, baseBranch, port, id]
    ),

  updateSessionPR: (
    prUrl: string | null,
    prNumber: number | null,
    prStatus: string | null,
    id: string
  ) =>
    execute(
      `UPDATE sessions SET pr_url = $1, pr_number = $2, pr_status = $3, updated_at = NOW() WHERE id = $4`,
      [prUrl, prNumber, prStatus, id]
    ),

  updateSessionGroup: (groupPath: string, id: string) =>
    execute(
      `UPDATE sessions SET group_path = $1, updated_at = NOW() WHERE id = $2`,
      [groupPath, id]
    ),

  getSessionsByGroup: (groupPath: string) =>
    query<Session>(
      `SELECT * FROM sessions WHERE group_path = $1 ORDER BY updated_at DESC`,
      [groupPath]
    ),

  moveSessionsToGroup: (newGroupPath: string, oldGroupPath: string) =>
    execute(
      `UPDATE sessions SET group_path = $1, updated_at = NOW() WHERE group_path = $2`,
      [newGroupPath, oldGroupPath]
    ),

  updateSessionProject: (projectId: string, id: string) =>
    execute(
      `UPDATE sessions SET project_id = $1, updated_at = NOW() WHERE id = $2`,
      [projectId, id]
    ),

  getSessionsByProject: (projectId: string) =>
    query<Session>(
      `SELECT * FROM sessions WHERE project_id = $1 ORDER BY updated_at DESC`,
      [projectId]
    ),

  getWorkersByConductor: (conductorId: string) =>
    query<Session>(
      `SELECT * FROM sessions WHERE conductor_session_id = $1 ORDER BY created_at ASC`,
      [conductorId]
    ),

  updateWorkerStatus: (workerStatus: string, id: string) =>
    execute(
      `UPDATE sessions SET worker_status = $1, updated_at = NOW() WHERE id = $2`,
      [workerStatus, id]
    ),

  createWorkerSession: (
    id: string,
    name: string,
    tmuxName: string,
    workingDirectory: string,
    conductorSessionId: string,
    workerTask: string,
    model: string | null,
    groupPath: string,
    agentType: string,
    projectId: string | null
  ) =>
    execute(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, conductor_session_id, worker_task, worker_status, model, group_path, agent_type, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)`,
      [
        id,
        name,
        tmuxName,
        workingDirectory,
        conductorSessionId,
        workerTask,
        model,
        groupPath,
        agentType,
        projectId,
      ]
    ),

  getAllGroups: () =>
    query<Group>(
      `SELECT * FROM groups ORDER BY sort_order ASC, name ASC`
    ),

  getGroup: (path: string) =>
    queryOne<Group>(`SELECT * FROM groups WHERE path = $1`, [path]),

  createGroup: (path: string, name: string, sortOrder: number) =>
    execute(
      `INSERT INTO groups (path, name, sort_order) VALUES ($1, $2, $3)`,
      [path, name, sortOrder]
    ),

  updateGroupName: (name: string, path: string) =>
    execute(`UPDATE groups SET name = $1 WHERE path = $2`, [name, path]),

  updateGroupExpanded: (expanded: boolean, path: string) =>
    execute(`UPDATE groups SET expanded = $1 WHERE path = $2`, [
      expanded,
      path,
    ]),

  updateGroupOrder: (sortOrder: number, path: string) =>
    execute(`UPDATE groups SET sort_order = $1 WHERE path = $2`, [
      sortOrder,
      path,
    ]),

  deleteGroup: (path: string) =>
    execute(`DELETE FROM groups WHERE path = $1`, [path]),

  createProject: (
    id: string,
    name: string,
    workingDirectory: string,
    agentType: string,
    defaultModel: string,
    initialPrompt: string | null,
    sortOrder: number
  ) =>
    execute(
      `INSERT INTO projects (id, name, working_directory, agent_type, default_model, initial_prompt, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, workingDirectory, agentType, defaultModel, initialPrompt, sortOrder]
    ),

  getProject: (id: string) =>
    queryOne<Project>(`SELECT * FROM projects WHERE id = $1`, [id]),

  getAllProjects: () =>
    query<Project>(
      `SELECT * FROM projects ORDER BY is_uncategorized ASC, sort_order ASC, name ASC`
    ),

  updateProject: (
    name: string,
    workingDirectory: string,
    agentType: string,
    defaultModel: string,
    initialPrompt: string | null,
    id: string
  ) =>
    execute(
      `UPDATE projects SET name = $1, working_directory = $2, agent_type = $3, default_model = $4, initial_prompt = $5, updated_at = NOW() WHERE id = $6`,
      [name, workingDirectory, agentType, defaultModel, initialPrompt, id]
    ),

  updateProjectExpanded: (expanded: boolean, id: string) =>
    execute(`UPDATE projects SET expanded = $1 WHERE id = $2`, [expanded, id]),

  updateProjectOrder: (sortOrder: number, id: string) =>
    execute(`UPDATE projects SET sort_order = $1 WHERE id = $2`, [
      sortOrder,
      id,
    ]),

  deleteProject: (id: string) =>
    execute(
      `DELETE FROM projects WHERE id = $1 AND is_uncategorized = FALSE`,
      [id]
    ),

  createProjectDevServer: (
    id: string,
    projectId: string,
    name: string,
    type: string,
    command: string,
    port: number | null,
    portEnvVar: string | null,
    sortOrder: number
  ) =>
    execute(
      `INSERT INTO project_dev_servers (id, project_id, name, type, command, port, port_env_var, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, projectId, name, type, command, port, portEnvVar, sortOrder]
    ),

  getProjectDevServer: (id: string) =>
    queryOne<ProjectDevServer>(
      `SELECT * FROM project_dev_servers WHERE id = $1`,
      [id]
    ),

  getProjectDevServers: (projectId: string) =>
    query<ProjectDevServer>(
      `SELECT * FROM project_dev_servers WHERE project_id = $1 ORDER BY sort_order ASC`,
      [projectId]
    ),

  updateProjectDevServer: (
    name: string,
    type: string,
    command: string,
    port: number | null,
    portEnvVar: string | null,
    sortOrder: number,
    id: string
  ) =>
    execute(
      `UPDATE project_dev_servers SET name = $1, type = $2, command = $3, port = $4, port_env_var = $5, sort_order = $6 WHERE id = $7`,
      [name, type, command, port, portEnvVar, sortOrder, id]
    ),

  deleteProjectDevServer: (id: string) =>
    execute(`DELETE FROM project_dev_servers WHERE id = $1`, [id]),

  deleteProjectDevServers: (projectId: string) =>
    execute(`DELETE FROM project_dev_servers WHERE project_id = $1`, [
      projectId,
    ]),

  createProjectRepository: (
    id: string,
    projectId: string,
    name: string,
    path: string,
    isPrimary: boolean,
    sortOrder: number
  ) =>
    execute(
      `INSERT INTO project_repositories (id, project_id, name, path, is_primary, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, projectId, name, path, isPrimary, sortOrder]
    ),

  getProjectRepository: (id: string) =>
    queryOne<ProjectRepository>(
      `SELECT * FROM project_repositories WHERE id = $1`,
      [id]
    ),

  getProjectRepositories: (projectId: string) =>
    query<ProjectRepository>(
      `SELECT * FROM project_repositories WHERE project_id = $1 ORDER BY sort_order ASC`,
      [projectId]
    ),

  updateProjectRepository: (
    name: string,
    path: string,
    isPrimary: boolean,
    sortOrder: number,
    id: string
  ) =>
    execute(
      `UPDATE project_repositories SET name = $1, path = $2, is_primary = $3, sort_order = $4 WHERE id = $5`,
      [name, path, isPrimary, sortOrder, id]
    ),

  deleteProjectRepository: (id: string) =>
    execute(`DELETE FROM project_repositories WHERE id = $1`, [id]),

  deleteProjectRepositories: (projectId: string) =>
    execute(`DELETE FROM project_repositories WHERE project_id = $1`, [
      projectId,
    ]),

  createDevServer: (
    id: string,
    projectId: string,
    type: string,
    name: string,
    command: string,
    status: string,
    pid: number | null,
    containerId: string | null,
    ports: string,
    workingDirectory: string
  ) =>
    execute(
      `INSERT INTO dev_servers (id, project_id, type, name, command, status, pid, container_id, ports, working_directory)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, projectId, type, name, command, status, pid, containerId, ports, workingDirectory]
    ),

  getDevServer: (id: string) =>
    queryOne<DevServer>(`SELECT * FROM dev_servers WHERE id = $1`, [id]),

  getAllDevServers: () =>
    query<DevServer>(
      `SELECT * FROM dev_servers ORDER BY created_at DESC`
    ),

  getDevServersByProject: (projectId: string) =>
    query<DevServer>(
      `SELECT * FROM dev_servers WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    ),

  updateDevServerStatus: (status: string, id: string) =>
    execute(
      `UPDATE dev_servers SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id]
    ),

  updateDevServerPid: (pid: number | null, status: string, id: string) =>
    execute(
      `UPDATE dev_servers SET pid = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [pid, status, id]
    ),

  updateDevServer: (
    status: string,
    pid: number | null,
    containerId: string | null,
    ports: string,
    id: string
  ) =>
    execute(
      `UPDATE dev_servers SET status = $1, pid = $2, container_id = $3, ports = $4, updated_at = NOW() WHERE id = $5`,
      [status, pid, containerId, ports, id]
    ),

  deleteDevServer: (id: string) =>
    execute(`DELETE FROM dev_servers WHERE id = $1`, [id]),

  deleteDevServersByProject: (projectId: string) =>
    execute(`DELETE FROM dev_servers WHERE project_id = $1`, [projectId]),
};
