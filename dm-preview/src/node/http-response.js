export const requestPath = (url) => {
  try {
    return decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return "";
  }
};

export const readBody = (request, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > limit) {
      reject(new Error("request body is too large"));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  request.on("error", reject);
});

export const sendJson = (request, response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
};
