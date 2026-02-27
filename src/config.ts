import { homedir } from "os";
import { join } from "path";

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
      "No Vercel token found. Set VERCEL_TOKEN or log in with `vercel login`."
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

  // Project: optional, from local .vercel/project.json
  let projectId: string | undefined;
  try {
    const projectPath = join(process.cwd(), ".vercel/project.json");
    const project = await Bun.file(projectPath).json();
    projectId = project.projectId;
  } catch {}

  return { token, teamId, projectId };
}
