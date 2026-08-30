import { readFileSync } from "node:fs";
import { join } from "node:path";

export const AGENT_SKILL_IDS = ["apply-with-grant"] as const;
export type AgentSkillId = (typeof AGENT_SKILL_IDS)[number];

export const AGENT_SKILL_ACTIONS = ["explain", "clarify", "plan"] as const;
export type AgentSkillAction = (typeof AGENT_SKILL_ACTIONS)[number];

export type AgentSkill = {
  id: AgentSkillId;
  description: string;
  instructions: string;
};

const SKILL_ROOT = join(process.cwd(), "lib/agent/skills");

const SKILL_FILES: Record<AgentSkillId, string> = {
  "apply-with-grant": "apply-with-grant/SKILL.md",
};

function frontmatterField(frontmatter: string, key: string): string | null {
  const line = frontmatter
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim() || null;
}

function readSkill(id: AgentSkillId): AgentSkill {
  const raw = readFileSync(join(SKILL_ROOT, SKILL_FILES[id]), "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Agent skill ${id} has no valid frontmatter.`);

  const name = frontmatterField(match[1], "name");
  const description = frontmatterField(match[1], "description");
  if (name !== id || !description) {
    throw new Error(`Agent skill ${id} has invalid name or description.`);
  }

  return { id, description, instructions: match[2].trim() };
}

let cache: AgentSkill[] | null = null;

/** Runtime skills are trusted local instructions, loaded once per process. */
export function loadAgentSkills(): AgentSkill[] {
  cache ??= AGENT_SKILL_IDS.map(readSkill);
  return cache;
}

export function isAgentSkillId(value: unknown): value is AgentSkillId {
  return typeof value === "string" && (AGENT_SKILL_IDS as readonly string[]).includes(value);
}

export function isAgentSkillAction(value: unknown): value is AgentSkillAction {
  return (
    typeof value === "string" &&
    (AGENT_SKILL_ACTIONS as readonly string[]).includes(value)
  );
}

/** Compact catalogue and instructions supplied only to the language layer. */
export function agentSkillsPrompt(): string {
  return loadAgentSkills()
    .map(
      (skill) =>
        `SKILL ${skill.id}\nDescription: ${skill.description}\n\n${skill.instructions}`,
    )
    .join("\n\n---\n\n");
}
