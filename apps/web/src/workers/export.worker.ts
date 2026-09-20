/**
 * Export worker entry — export/dispose only. Spawned lazily at first export;
 * sequential requests guarantee one artifact build at a time.
 */
import { WorkerSupervisor } from './supervisor.ts';

const scope = self as unknown as {
  postMessage: (message: unknown, transfer: Transferable[]) => void;
  onmessage: ((event: { data: unknown }) => void) | null;
};

const supervisor = new WorkerSupervisor((message, transfer) => scope.postMessage(message, transfer));

scope.onmessage = (event: { data: unknown }) => {
  void supervisor.handleMessage(event.data);
};
