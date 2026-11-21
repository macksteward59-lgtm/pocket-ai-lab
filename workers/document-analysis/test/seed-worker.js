// Local test entry point. Wrangler packages worker.js for deployment.
import { DurableObject } from "cloudflare:workers";
import { TaskLifecycleCoordinator } from "../../../packages/intelligence/autonomy/TaskLifecycleCoordinator.ts";
import { DurableTaskLifecycleStore } from "../../../packages/intelligence/cloud/cloudflare/DurableTaskLifecycleStore.ts";

export class DocumentAnalysisState extends DurableObject {
  async seed(attemptID) {
    const open = () => new TaskLifecycleCoordinator({ store: new DurableTaskLifecycleStore(this.ctx.storage.sql) });
    const writer = open();
    const stale = open();
    await Promise.all([writer.init(), stale.init()]);
    const id = "cloudflare-analysis:" + attemptID;
    const definition = {
      id, objective: "Fixture documentation",
      metadata: { kind: "cloudflare-analysis", providerID: "cloudflare-workers-ai", attemptID },
      steps: [{ id: "analyze-selected-text", description: "Summarize a fixture" }]
    };
    await writer.createTask(definition);
    try {
      await stale.createTask({ ...definition, id: "must-not-overwrite" });
      throw new Error("Stale write succeeded");
    } catch (error) {
      if (error.code !== "store_conflict") throw error;
    }
    const claim = await writer.claimNextStep(id);
    await writer.completeStep({
      taskId: id, stepId: claim.stepId, attemptId: claim.attemptId,
      result: "Private fixture text that status must omit"
    });
  }
}

export default {
  async fetch(request, env) {
    await env.ANALYSIS_STATE.getByName("document-analysis-v1").seed(await request.text());
    return new Response(null, { status: 204 });
  }
};
