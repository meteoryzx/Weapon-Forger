import { applyForgeIntent, type CutOperation, type ForgeState } from "../forge/index.ts";

self.onmessage = (event: MessageEvent<{ id: number; state: ForgeState; operation: CutOperation }>) => {
  const { id, state, operation } = event.data;
  try { self.postMessage({ id, result: applyForgeIntent(state, operation) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
