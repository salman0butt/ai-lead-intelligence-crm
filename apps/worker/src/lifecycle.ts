export interface WorkerDatabase {
  $connect(): Promise<unknown>;
  $disconnect(): Promise<unknown>;
}

export function createWorkerLifecycle(database: WorkerDatabase) {
  return {
    async start() {
      await database.$connect();
    },
    async stop() {
      await database.$disconnect();
    },
  };
}
