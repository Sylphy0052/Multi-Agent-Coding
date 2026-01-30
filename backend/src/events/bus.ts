import { EventEmitter } from "node:events";
import type { BusEvent, EventType } from "./types.js";

export class EventBus {
  private emitter = new EventEmitter();
  private processedKeys = new Set<string>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: BusEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  /**
   * Emit an event only if the given idempotency key has not been processed.
   * Prevents double-processing of the same task completion, etc.
   */
  emitIdempotent(event: BusEvent, key: string): boolean {
    if (this.processedKeys.has(key)) return false;
    this.processedKeys.add(key);
    this.emit(event);
    return true;
  }

  /**
   * Check if an idempotency key has already been processed.
   */
  isProcessed(key: string): boolean {
    return this.processedKeys.has(key);
  }

  /**
   * Clear all processed idempotency keys.
   */
  clearProcessedKeys(): void {
    this.processedKeys.clear();
  }

  on(type: EventType | "*", handler: (event: BusEvent) => void): void {
    this.emitter.on(type, handler);
  }

  once(type: EventType | "*", handler: (event: BusEvent) => void): void {
    this.emitter.once(type, handler);
  }

  off(type: EventType | "*", handler: (event: BusEvent) => void): void {
    this.emitter.off(type, handler);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
