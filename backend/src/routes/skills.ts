import type { FastifyInstance } from "fastify";
import type { SkillsRegistry } from "../skills/registry.js";

export interface SkillsRouteDeps {
  skillsRegistry: SkillsRegistry;
}

export async function registerSkillsRoutes(
  app: FastifyInstance,
  deps: SkillsRouteDeps,
): Promise<void> {
  const { skillsRegistry } = deps;

  // GET /api/skills - List all skills
  app.get("/api/skills", async (_request, reply) => {
    const skills = skillsRegistry.listAll();
    return reply.send(skills);
  });

  // GET /api/skills/:id - Get skill detail
  app.get("/api/skills/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const skill = skillsRegistry.getSkill(id);
    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }
    return reply.send(skill);
  });
}
