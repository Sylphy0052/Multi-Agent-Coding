import { EventEmitter } from "node:events";
import type { BusEvent, EventType } from "./types.js";

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: BusEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  on(type: EventType | "*", handler: (event: BusEvent) => void): void {
    this.emitter.on(type, handler);
  }

  off(type: EventType | "*", handler: (event: BusEvent) => void): void {
    this.emitter.off(type, handler);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
