import { app } from "./app.js";
import { runScheduledSync } from "./ical/sync.js";

export default {
  fetch: app.fetch,

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledSync(env));
  },
};
