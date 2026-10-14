import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";

/**
 * One Socket.IO server on the API's HTTP server (path `/ws`); each feature adds its own namespace.
 * Namespaces are attached once the server is ready and the server is closed with the app.
 */
export interface Realtime {
  /** Runs when the server exists; `onClose` runs before it shuts down. */
  use(attach: (io: Server) => void | (() => void | Promise<void>)): void;
}

export function createRealtime(app: FastifyInstance, origins: string[]): Realtime {
  const attachers: Array<(io: Server) => void | (() => void | Promise<void>)> = [];
  const closers: Array<() => void | Promise<void>> = [];
  let io: Server | undefined;

  app.addHook("onReady", async () => {
    io = new Server(app.server, {
      path: "/ws",
      cors: { origin: origins, credentials: true },
      // 64 KB: a chat message or one shared-editor update; code snapshots go over REST
      maxHttpBufferSize: 64 * 1024,
    });
    for (const attach of attachers) {
      const close = attach(io);
      if (close) closers.push(close);
    }
  });
  app.addHook("onClose", async () => {
    for (const close of closers) await close();
    await new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()));
  });

  return { use: (attach) => void attachers.push(attach) };
}
