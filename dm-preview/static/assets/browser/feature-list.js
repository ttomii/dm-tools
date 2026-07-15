import {featureMeta, featureTitle} from "../core/feature-labels.js";

export const renderFeatureItems = ({features, list, onSelect, selectedIndex}) => {
  list.replaceChildren(...features.map((feature) => createFeatureListItem(feature, list, onSelect)));
  if (selectedIndex === undefined) return;
  list.querySelectorAll(".feature-list-item")[selectedIndex]?.classList.add("selected");
};

const createFeatureListItem = (feature, list, onSelect) => {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "feature-list-item";
  button.append(createText("feature-list-title", featureTitle(feature)));
  button.append(createText("feature-list-meta", featureMeta(feature)));
  button.addEventListener("click", () => {
    selectFeatureListItem(list, button);
    onSelect(feature);
  });
  item.append(button);
  return item;
};

const selectFeatureListItem = (list, button) => {
  for (const selected of list.querySelectorAll(".feature-list-item.selected")) {
    selected.classList.remove("selected");
  }
  button.classList.add("selected");
};

const createText = (className, text) => {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
};
