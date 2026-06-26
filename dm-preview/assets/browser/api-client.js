export const createApiClient = ({appBase, fetch}) => {
  const resourceUrl = (relativePath) => new URL(
    relativePath.split("/").map(encodeURIComponent).join("/"),
    appBase,
  ).toString();

  const fetchJson = async (url, options) => fetch(url, options)
    .then(checkResponse)
    .then((response) => response.json());

  return {
    resourceUrl,
    manifest: () => fetchJson(resourceUrl("pmtiles-manifest.json")),
    style: (url) => fetchJson(url),
    features: (query) => fetchJson(apiUrl(appBase, "api/features", query)),
    styleEditorState: () => fetchJson(new URL("api/style-editor/state", appBase)),
    saveStyleEditorState: (body) => fetch(new URL("api/style-editor/state", appBase), {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    }).then(checkResponse),
  };
};

export const checkResponse = (response) => {
  if (!response.ok) throw new Error(`${response.status} ${response.url}`);
  return response;
};

const apiUrl = (appBase, path, query) => {
  const url = new URL(path, appBase);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url;
};
