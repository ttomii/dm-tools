import {canReuseInspectCatalog} from "./inspect-catalog.js";
import {createDefaultAssetRoots} from "./asset-roots.js";
import {createInspectHandler} from "./inspect-api.js";
import {createInspectSession} from "./inspect-session.js";
import {openBrowser} from "./open-browser.js";
import {startServer} from "./server.js";

export const startInspect = async (options, dependencies) => {
  const session = await createInspectSession(options, dependencies);
  let server;
  try {
    const started = await startServer(session.presentation, {...dependencies, ...createDefaultAssetRoots(),
      port: options.port, getContext: session.context, handleRequest: createInspectHandler(session)});
    server = started.server;
    if (session.state().catalog && !await canReuseInspectCatalog(session.context(), session.state().converter)) session.start();
    console.log(started.url);
    if (!options.noOpen) await openBrowser(started.url).catch((error) => console.error(`warning: ${error.message}`));
    await waitForInspectShutdown(server, session);
  } finally { server?.close(); await session.close(); }
};

const waitForInspectShutdown = (server, session) => new Promise((resolve, reject) => {
  const close = () => session.close().then(() => server.close(), reject);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  server.once("close", () => {
    process.off("SIGINT", close); process.off("SIGTERM", close);
    resolve();
  });
  server.once("error", reject);
});
