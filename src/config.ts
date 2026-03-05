import { homedir } from "os";
import { join, dirname } from "path";

export async function getConfig(): Promise<{
  token: string;
  teamId?: string;
  projectId?: string;
}> {
  // Token: env var > Vercel CLI auth file
  let token = process.env.VERCEL_TOKEN;

  if (!token) {
    try {
      const authPath = join(
        homedir(),
        ".local/share/com.vercel.cli/auth.json"
      );
      const auth = await Bun.file(authPath).json();
      token = auth.token;
    } catch {}
  }

  if (!token) {
    throw new Error(
      "No Vercel token found. Set VERCEL_TOKEN — get one at vercel.com/account/tokens"
    );
  }

  // Team: optional, from Vercel CLI config
  let teamId: string | undefined;
  try {
    const configPath = join(
      homedir(),
      ".local/share/com.vercel.cli/config.json"
    );
    const config = await Bun.file(configPath).json();
    teamId = config.currentTeam;
  } catch {}

  // Project: optional, walk up from cwd to find .vercel/project.json
  let projectId: string | undefined;
  let dir = process.cwd();
  while (true) {
    try {
      const project = await Bun.file(join(dir, ".vercel/project.json")).json();
      projectId = project.projectId;
      break;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { token, teamId, projectId };
}

/**
 * Get Axiom token for runtime log queries.
 * Checks: AXIOM_TOKEN env var > ~/.config/axiom/token
 */
export async function getAxiomToken(): Promise<string> {
  let token = process.env.AXIOM_TOKEN;

  if (!token) {
    try {
      const tokenPath = join(homedir(), ".config/axiom/token");
      token = (await Bun.file(tokenPath).text()).trim();
    } catch {}
  }

  if (!token) {
    throw new Error(
      "No Axiom token found. Set AXIOM_TOKEN or create ~/.config/axiom/token"
    );
  }

  return token;
}

/**
 * Resolve a project name or ID to a project ID.
 * If input looks like a project ID (starts with prj_), use it directly.
 * Otherwise, search by name.
 */
export async function resolveProjectId(
  config: { token: string; teamId?: string },
  nameOrId: string
): Promise<string> {
  if (nameOrId.startsWith("prj_")) return nameOrId;

  const BASE = process.env.VX_API_BASE || "https://api.vercel.com";
  const teamQuery = config.teamId ? `&teamId=${config.teamId}` : "";
  const res = await fetch(
    `${BASE}/v9/projects?search=${encodeURIComponent(nameOrId)}${teamQuery}`,
    { headers: { Authorization: `Bearer ${config.token}` } }
  );
  const data = await res.json() as any;
  const match = data.projects?.find(
    (p: any) => p.name === nameOrId || p.id === nameOrId
  );
  if (!match) {
    throw new Error(`Project not found: ${nameOrId}`);
  }
  return match.id;
}
