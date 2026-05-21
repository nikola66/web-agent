import fs from "node:fs/promises";
import {
  AGENT_MD,
  CONTEXT_UPDATE_END,
  CONTEXT_UPDATE_START,
  PROFILE_UPDATE_END,
  PROFILE_UPDATE_START,
  SELF_IMPROVEMENT_END,
  SELF_IMPROVEMENT_START,
  USER_MD,
  USER_UPDATE_END,
  USER_UPDATE_START,
} from "../constants.js";
import { cyan, dim, green } from "../terminal-format.js";

const brightWhite = (s) => `\x1b[97m${s}\x1b[0m`;

export function cleanSetupName(input, fallback) {
  const value = String(input || "").trim();
  return value || fallback;
}

async function promptForValue(rl, question, fallback) {
  while (true) {
    const answer = await rl.question(question);
    const cleaned = cleanSetupName(answer, fallback);
    if (cleaned) return cleaned;
  }
}

export function emitProfileUpdate(name) {
  process.stdout.write(
    `${PROFILE_UPDATE_START}${JSON.stringify({ name })}${PROFILE_UPDATE_END}`
  );
}

export function emitUserUpdate(name) {
  process.stdout.write(
    `${USER_UPDATE_START}${JSON.stringify({ name })}${USER_UPDATE_END}`
  );
}

export function emitContextUpdate(payload) {
  process.stdout.write(
    `${CONTEXT_UPDATE_START}${JSON.stringify(payload)}${CONTEXT_UPDATE_END}`
  );
}

export function emitSelfImprovementSummary(payload: {
  summary: string;
  kind?: string | null;
  source?: string | null;
  at?: string;
}) {
  process.stdout.write(
    `${SELF_IMPROVEMENT_START}${JSON.stringify({
      at: payload.at || new Date().toISOString(),
      summary: String(payload.summary || "").trim(),
      kind: payload.kind || null,
      source: payload.source || null,
    })}${SELF_IMPROVEMENT_END}`
  );
}

export function buildAgentMd(agentName, userName) {
  const basePersonality =
    process.env.WEBAGENT_PERSONALITY || "You are a helpful assistant.";
  return `# ${agentName}

${basePersonality}

## Relationship

- Your name is ${agentName}.
- You are working with ${userName}.
- Treat the first conversation as the foundation for future collaboration.
- Be direct, useful, and warm without becoming verbose.
- When you use tools, briefly state what you are doing and why.
- For multi-step requests, continue autonomously until the full task is complete.
- Do not pause after announcing a step; immediately emit the next tool call when one is needed.
`;
}

export function buildUserMd(userName) {
  return `# ${userName}

## User

- Preferred name: ${userName}
- Relationship started: ${new Date().toISOString()}
- The assistant should learn preferences from future conversations and keep useful context here when asked.
`;
}

export function parseUserNameFromUserMd(content) {
  const text = String(content || "");
  const preferred = text.match(/^\s*-\s*Preferred name:\s*(.+)$/mi)?.[1]?.trim();
  if (preferred) return preferred;
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return "";
}

async function writeIdentityFiles(agentName, userName) {
  const safeAgentName = cleanSetupName(agentName, "Agent");
  const safeUserName = cleanSetupName(userName, "User");
  await fs.writeFile(AGENT_MD, buildAgentMd(safeAgentName, safeUserName), "utf8");
  await fs.writeFile(USER_MD, buildUserMd(safeUserName), "utf8");
}

export async function synchronizeIdentityFiles(profileName, userName) {
  const nextAgentName = cleanSetupName(profileName, "Agent");
  const nextUserName = cleanSetupName(userName, "User");
  const currentAgent = await fs.readFile(AGENT_MD, "utf8").catch(() => "");
  const currentUser = await fs.readFile(USER_MD, "utf8").catch(() => "");
  if (currentAgent.trim() !== buildAgentMd(nextAgentName, nextUserName).trim()) {
    await fs.writeFile(AGENT_MD, buildAgentMd(nextAgentName, nextUserName), "utf8");
  }
  if (currentUser.trim() !== buildUserMd(nextUserName).trim()) {
    await fs.writeFile(USER_MD, buildUserMd(nextUserName), "utf8");
  }
}

export async function runFirstRunSetup(rl, fileExists) {
  const hasAgent = await fileExists(AGENT_MD);
  const hasUser = await fileExists(USER_MD);
  if (hasAgent && hasUser) {
    return {
      agentName: cleanSetupName(process.env.WEBAGENT_PROFILE_NAME, "Agent"),
      userName: cleanSetupName(process.env.WEBAGENT_USER_NAME, "User"),
    };
  }

  const proposedAgentName = cleanSetupName(
    process.env.WEBAGENT_PROFILE_NAME,
    "Neon Oracle"
  );
  const proposedUserName = cleanSetupName(process.env.WEBAGENT_USER_NAME, "User");

  process.stdout.write("<<<WEBAGENT_ONBOARDING_START>>>");
  console.log("");
  console.log(cyan("First-run setup"));
  console.log(dim("Tell me how to address both of us in this workspace."));
  console.log("");
  const agentName = await promptForValue(
    rl,
    brightWhite(`Agent name [${proposedAgentName}]: `),
    proposedAgentName
  );
  console.log("");
  const userName = await promptForValue(
    rl,
    brightWhite(`Your name [${proposedUserName}]: `),
    proposedUserName
  );

  await writeIdentityFiles(agentName, userName);
  process.env.WEBAGENT_AGENT_NAME = agentName;
  process.env.WEBAGENT_USER_NAME = userName;
  emitProfileUpdate(agentName);
  emitUserUpdate(userName);
  console.log("");
  console.log(green(`Saved AGENT.md for ${agentName} and USER.md for ${userName}.`));
  console.log("");
  process.stdout.write("<<<WEBAGENT_ONBOARDING_END>>>");
  return { agentName, userName };
}
