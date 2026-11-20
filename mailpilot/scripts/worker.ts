// Standalone worker for any host that can run Node (VPS, Docker, Railway, Fly): `npm run worker`.
// It runs the same runTick() as the cron route. Run one or several; the database hands each message to exactly one of them.
import { runTick } from "../src/lib/queue/worker";

const IDLE_MS = Number(process.env.WORKER_IDLE_MS) || 3000;
let stop = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { console.info(`[worker] ${sig}: finishing the current round, then exiting`); stop = true; });

(async () => {
  console.info("[worker] started");
  while (!stop) {
    try {
      const r = await runTick({ budgetMs: 10_000 });
      if (r.claimed) console.info(`[worker] ${JSON.stringify(r)}`);
    } catch (e) { console.error("[worker] tick failed:", e instanceof Error ? e.message : e); }
    if (!stop) await new Promise((res) => setTimeout(res, IDLE_MS));
  }
  console.info("[worker] stopped");
})();
