// tailf-alert-sender: the hourly cron that sends web alert digests.
// Deployed by .github/workflows/pages-deployment.yaml next to the Pages site;
// it shares the ALERTS KV namespace with the /api/alerts Pages Functions.
import { runAlerts } from '../../lib/alerts/sender.mjs';
import { authority, forwardTrigger, handlePrimaryRequest } from '../../lib/alerts/primary.mjs';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      authority(env).then((a) => a ? forwardTrigger(event, env, a) : runAlerts(env)).then(
        (summary) => console.log(JSON.stringify({ alertRun: summary })),
        (error) => console.error('alert run failed', error && error.stack || error),
      ),
    );
  },
  async fetch(request, env) {
    return handlePrimaryRequest(request, env);
  },
};
