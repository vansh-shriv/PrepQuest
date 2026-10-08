import type { FastifyPluginAsync } from "fastify";

export type HealthChecks = Record<string, () => Promise<void>>;

export const healthRoutes: FastifyPluginAsync<{ checks: HealthChecks }> = async (
  app,
  { checks },
) => {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_req, reply) => {
    const results: Record<string, "up" | "down"> = {};
    for (const [name, check] of Object.entries(checks)) {
      try {
        await check();
        results[name] = "up";
      } catch {
        results[name] = "down";
      }
    }
    const ok = Object.values(results).every((s) => s === "up");
    return reply.status(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", checks: results });
  });
};
