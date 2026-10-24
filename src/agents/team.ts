import { Agent, type Tool } from '@openai/agents';

export type MokiRunContext = { productId: string; revision: number };
type Role = 'mechanical' | 'electrical' | 'firmware' | 'validator' | 'launch';

/** Role definitions only: supply tested adapters before enabling autonomous engineering runs. */
export function createMokiTeam(tools: Partial<Record<Role, Tool<MokiRunContext>[]>> = {}) {
  const model = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
  const roles: Record<Role, string> = {
    mechanical: 'Create mechanical artifacts from the exact PCB geometry contract. Record input hashes. Flag unknown clearances.',
    electrical: 'Create electronics artifacts. Publish geometry measured by tools from saved files; never invent dimensions or component heights.',
    firmware: 'Use the published pin/protocol contract. Compile and execute fixed simulation scenarios. Record the tested source hash.',
    validator: 'Inspect actual artifacts with independent checks. Return pass, fail or blocked with checker version, tested hashes and evidence. Do not weaken acceptance criteria.',
    launch: 'Create showcase and launch assets grounded in the current product revision. Identify generated backgrounds and unsupported claims.',
  };
  const specialists = Object.fromEntries(Object.entries(roles).map(([role, instructions]) => [role,
    new Agent<MokiRunContext>({ name: `Moki ${role}`, model, instructions, tools: tools[role as Role] || [] }),
  ])) as Record<Role, Agent<MokiRunContext>>;
  const manager = new Agent<MokiRunContext>({
    name: 'Moki', model,
    instructions: 'You are a warm, precise workshop partner. Coordinate specialist work through the shared product contract. Only application code commits revisions and releases. Report checked evidence separately from proposed work. Never claim a physical build from a simulation.',
    tools: Object.entries(specialists).map(([role, agent]) => agent.asTool({ toolName: `consult_${role}`, toolDescription: `Delegate a bounded ${role} task for the current product revision.` })),
  });
  return { manager, specialists };
}
