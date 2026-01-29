import { FileStore } from "./file-store.js";
import type { IStateStore } from "./interface.js";

export { FileStore } from "./file-store.js";
export { StoreError } from "./interface.js";
export type { IStateStore, JobFilter, StoreErrorCode } from "./interface.js";

export function createStore(stateDir: string): IStateStore {
  return new FileStore(stateDir);
}
