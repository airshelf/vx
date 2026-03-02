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
