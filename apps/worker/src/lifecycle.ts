export interface WorkerDatabase {
  $connect(): Promise<unknown>;
  $disconnect(): Promise<unknown>;
}

export interface WorkerQueue {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

export function createWorkerLifecycle(database: WorkerDatabase, queue?: WorkerQueue) {
  return {
    async start() {
      await database.$connect();
      await queue?.start();
    },
    async stop() {
      await queue?.stop();
      await database.$disconnect();
    },
  };
}
