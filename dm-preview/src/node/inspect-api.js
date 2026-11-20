import path from "node:path";
import {createDefaultAssetRoots} from "./asset-roots.js";
import {readBody, sendJson} from "./http-response.js";
import {resolveFile, sendFile} from "./static-files.js";

export const createInspectHandler = (session) => async (request, response) => {
  if (!validLocalRequest(request)) { sendJson(request, response, 403, {error: "local same-origin request required"}); return true; }
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (!pathname.startsWith("/preview/api/inspect") && !pathname.startsWith("/preview/inspect-data/")) return false;
  if (pathname === "/preview/api/inspect/geojson" && ["GET", "HEAD"].includes(request.method)) {
    try {
      const context = session.context();
      if (!context?.manifest.geojson) sendJson(request, response, 503, {error: "catalog GeoPackage is not ready"});
      else sendJson(request, response, 200, await context.featureStore.geojson());
    } catch (error) { sendJson(request, response, error.status ?? 500, {error: error.message}); }
    return true;
  }
  if (pathname.startsWith("/preview/inspect-data/")) {
    await respondData(request, response, pathname, session.root);
    return true;
  }
  if (pathname === "/preview/api/inspect/state" && ["GET", "HEAD"].includes(request.method)) {
    sendJson(request, response, 200, session.state()); return true;
  }
  if (request.method === "POST" && ["/preview/api/inspect/convert", "/preview/api/inspect/cancel"].includes(pathname)) {
    try {
      if (pathname.endsWith("/convert")) {
        const body = await readBody(request, 4096);
        const options = body ? JSON.parse(body) : {};
        session.start(options.levels);
      } else session.cancel();
      sendJson(request, response, 202, session.state());
    } catch (error) { sendJson(request, response, error.status ?? 500, {error: error.message}); }
    return true;
  }
  sendJson(request, response, 405, {error: "unsupported inspect operation"});
  return true;
};

export const validLocalRequest = (request) => {
  const host = request.headers.host;
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host ?? "")) return false;
  return !request.headers.origin || request.headers.origin === `http://${host}`;
};

const respondData = async (request, response, pathname, root) => {
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
  const match = /^\/preview\/inspect-data\/([a-f0-9-]{36})\/(.+)$/.exec(pathname);
  if (!match || !/\.pmtiles$/.test(match[2])) { response.writeHead(404); response.end(); return; }
  const file = await resolveFile(`/${match[2]}`, path.join(root, "runs", match[1]), createDefaultAssetRoots());
  if (file) await sendFile(request, response, file);
  else { response.writeHead(404); response.end(); }
};
