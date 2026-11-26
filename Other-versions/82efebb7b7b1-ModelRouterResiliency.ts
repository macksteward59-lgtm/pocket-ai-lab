/**
 * Retry a failed model selection a bounded number of times.
 * A failed route stays a failure. This class does not invent a model.
 */
import type { ModelDescriptor } from "../model-registry/ModelRegistry";
import type { ModelRouter } from "./ModelRouter";

type Route = ModelRouter["route"];
type RouterLifecycle = { route: Route } &
  Partial<Pick<ModelRouter, "release" | "confirmLoaded">>;

export class ModelRouterResiliency {
  constructor(
    private readonly router: RouterLifecycle,
    private readonly maxAttempts = 2
  ) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
      throw new Error("maxAttempts must be 1, 2, or 3");
    }
  }

  confirmLoaded(descriptor: ModelDescriptor): void {
    this.router.confirmLoaded?.(descriptor);
  }

  release(descriptor: ModelDescriptor): void {
    this.router.release?.(descriptor);
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
