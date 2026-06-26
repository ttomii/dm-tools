import {ApiInputError} from "../gpkg-features.js";
import {sendJson} from "./http-response.js";

export const FEATURES_PATH = "/preview/api/features";

export const respondFeatures = (request, response, featureStore) => {
  if (featureStore instanceof Error) {
    sendJson(request, response, featureStore.status ?? 500, {error: featureStore.message});
    return;
  }
  if (!featureStore) {
    sendJson(request, response, 404, {error: "feature API is not available"});
    return;
  }
  try {
    const url = new URL(request.url, "http://localhost");
    sendJson(request, response, 200, featureStore.search(url.searchParams));
  } catch (error) {
    if (error instanceof ApiInputError) {
      sendJson(request, response, error.status, {error: error.message});
      return;
    }
    throw error;
  }
};
