/**
 * Retry a failed model selection a bounded number of times.
 * A failed route stays a failure. This class does not invent a model.
 */
import { ModelDescriptor } from "../model-registry/ModelRegistry";
import { ModelRouter } from "./ModelRouter";

type Route = ModelRouter["route"];

export class ModelRouterResiliency {
  constructor(
    private readonly router: { route: Route },
    private readonly maxAttempts = 2
  ) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
      throw new Error("maxAttempts must be 1, 2, or 3");
    }
  }

  async routeWithRetry(...args: Parameters<Route>): Promise<ModelDescriptor> {
    let last: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        return await this.router.route(...args);
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error("Model routing failed");
  }
}
