/**
 * @focal-ai/core — pure taste/render engine.
 *
 * Standalone: this package imports nothing from @focal-ai/qloo. apps/web and
 * @focal-ai/mcp adapt between the two packages (the CoreSearchFn seam).
 * Public exports match docs/contracts.md Block B.
 */

export * from "./types";
export * from "./profile";
export * from "./resolve";
export * from "./rank";
export * from "./plan";
export * from "./evidence";
export * from "./pipeline";
export * from "./taste";
export * from "./signals";
export * from "./lift";
export * from "./labels";
export * from "./neverRun";
export * from "./neverRunGroups";
export * from "./pagePipeline";

export const VERSION = "0.0.1";
