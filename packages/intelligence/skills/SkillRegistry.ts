/**
 * Skill (capability) registry.
 *
 * Skills are registered first and then connected to agents, so adding a new
 * technology or research discipline does not require creating a new agent.
 * A skill is knowledge and a capability identifier only: it carries no tool
 * access and grants no permission. Execution is always decided by the
 * delegation gate and the APEX policy table.
 *
 * `ecosystem` keeps the registry vendor-neutral: Microsoft is the first fully
 * developed ecosystem, not a hard-coded assumption.
 */
import { CORE_AGENTS, SECURITY_SPECIALIST_IDS, type SecuritySpecialistId } from "../agents/AgentManager";

export type SkillLayer = 1 | 2 | 3 | 4 | 5;
export type Ecosystem = "general" | "microsoft";

export interface Skill {
  /** Capability identifier, lowercase kebab-case. */
  id: string;
  layer: SkillLayer;
  title: string;
  /** Topics this skill covers. */
  knowledge: string[];
  /** Specialist templates that hold this skill. */
  specialists: SecuritySpecialistId[];
  /** Permanent core agent ids that hold this skill (e.g. "engineer"). */
  coreAgents: string[];
  ecosystem: Ecosystem;
  /** Informational: exercise only inside the isolated lab. Tool use is still gated separately. */
  labOnly: boolean;
}

export interface SkillOwners {
  specialists: SecuritySpecialistId[];
  coreAgents: string[];
}

export interface SkillFilter {
  layer?: SkillLayer;
  ecosystem?: Ecosystem;
  specialist?: SecuritySpecialistId;
  coreAgent?: string;
  labOnly?: boolean;
}

const CORE_AGENT_IDS = new Set(CORE_AGENTS.map(agent => agent.id));
const SPECIALIST_IDS = new Set<string>(SECURITY_SPECIALIST_IDS);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function clone(skill: Skill): Skill {
  return { ...skill, knowledge: [...skill.knowledge], specialists: [...skill.specialists], coreAgents: [...skill.coreAgents] };
}

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  constructor(initial: Skill[] = []) {
    initial.forEach(skill => this.register(skill));
  }

  register(skill: Skill): void {
    if (!ID_PATTERN.test(skill.id ?? "")) throw new Error("Skill id must be lowercase kebab-case: " + skill.id);
    if (this.skills.has(skill.id)) throw new Error("Skill already registered: " + skill.id);
    if (!skill.title?.trim()) throw new Error("Skill " + skill.id + " needs a title");
    if (![1, 2, 3, 4, 5].includes(skill.layer)) throw new Error("Skill " + skill.id + " has an invalid layer");
    if (!skill.knowledge?.length || skill.knowledge.some(topic => !topic?.trim())) {
      throw new Error("Skill " + skill.id + " needs at least one non-empty knowledge topic");
    }
    for (const id of skill.specialists) {
      if (!SPECIALIST_IDS.has(id)) throw new Error("Skill " + skill.id + " names an unknown specialist: " + id);
    }
    for (const id of skill.coreAgents) {
      if (!CORE_AGENT_IDS.has(id)) throw new Error("Skill " + skill.id + " names an unknown core agent: " + id);
    }
    if (skill.specialists.length + skill.coreAgents.length === 0) {
      throw new Error("Skill " + skill.id + " must be held by at least one agent");
    }
    this.skills.set(skill.id, clone(skill));
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  get(id: string): Skill | undefined {
    const skill = this.skills.get(id);
    return skill ? clone(skill) : undefined;
  }

  list(filter: SkillFilter = {}): Skill[] {
    return [...this.skills.values()]
      .filter(skill =>
        (filter.layer === undefined || skill.layer === filter.layer) &&
        (filter.ecosystem === undefined || skill.ecosystem === filter.ecosystem) &&
        (filter.specialist === undefined || skill.specialists.includes(filter.specialist)) &&
        (filter.coreAgent === undefined || skill.coreAgents.includes(filter.coreAgent)) &&
        (filter.labOnly === undefined || skill.labOnly === filter.labOnly))
      .map(clone);
  }

  /** Who holds a skill. Throws for an unknown skill so typos fail loudly. */
  ownersOf(id: string): SkillOwners {
    const skill = this.skills.get(id);
    if (!skill) throw new Error("Unknown skill: " + id);
    return { specialists: [...skill.specialists], coreAgents: [...skill.coreAgents] };
  }

  /** Skill ids held by a specialist template. */
  skillIdsFor(specialist: SecuritySpecialistId): string[] {
    return [...this.skills.values()].filter(skill => skill.specialists.includes(specialist)).map(skill => skill.id);
  }

  /** Ids of skills whose knowledge includes a topic (case-insensitive, exact). */
  skillsCoveringTopic(topic: string): string[] {
    const wanted = topic.trim().toLowerCase();
    return [...this.skills.values()]
      .filter(skill => skill.knowledge.some(known => known.toLowerCase() === wanted))
      .map(skill => skill.id);
  }
}
