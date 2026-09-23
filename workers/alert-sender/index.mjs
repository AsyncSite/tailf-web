// tailf-alert-sender: the hourly cron that sends web alert digests.
// Deployed by .github/workflows/pages-deployment.yaml next to the Pages site;
// it shares the ALERTS KV namespace with the /api/alerts Pages Functions.
import { runAlerts } from '../../lib/alerts/sender.mjs';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runAlerts(env).then(
        (summary) => console.log(JSON.stringify({ alertRun: summary })),
        (error) => console.error('alert run failed', error && error.stack || error),
      ),
    );
  },
  async fetch() {
    return new Response('not here', { status: 404 });
  },
};
