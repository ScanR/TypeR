const buildFolderTree = (folders) => {
  const map = new Map();
  (folders || []).forEach((folder) => {
    map.set(folder.id, { ...folder, children: [] });
  });
  const roots = [];
  map.forEach((folder) => {
    if (folder.parentId && map.has(folder.parentId)) {
      map.get(folder.parentId).children.push(folder);
    } else {
      roots.push(folder);
    }
  });
  const sortRecursive = (nodes) => {
    nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    nodes.forEach((node) => sortRecursive(node.children));
  };
  sortRecursive(roots);
  return roots;
};

const flattenFolderTree = (nodes, parents = [], depth = 0) => {
  const list = [];
  nodes.forEach((node) => {
    const breadcrumb = parents.concat(node.name);
    list.push({
      id: node.id,
      name: node.name,
      parentId: node.parentId || null,
      depth,
      label: breadcrumb.join(" / "),
      children: node.children || [],
    });
    list.push(...flattenFolderTree(node.children || [], breadcrumb, depth + 1));
  });
  return list;
};

const collectDescendantIds = (folders, folderId) => {
  const ids = [];
  if (!folderId) return ids;
  // Index children once so deep or wide folder trees stay linear.
  const childrenByParent = new Map();
  (folders || []).forEach((folder) => {
    const parentId = folder.parentId || null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(folder);
  });
  const queue = [folderId];
  const visited = new Set([folderId]);
  for (let index = 0; index < queue.length; index++) {
    const children = childrenByParent.get(queue[index]) || [];
    children.forEach((child) => {
      if (visited.has(child.id)) return;
      visited.add(child.id);
      ids.push(child.id);
      queue.push(child.id);
    });
  }
  return ids;
};

const getAutomaticTagStyles = (styles, currentStyleId, isolateCurrentFolder = true) => {
  const availableStyles = styles || [];
  if (!isolateCurrentFolder) return availableStyles;

  const currentStyle = availableStyles.find((style) => style.id === currentStyleId);
  if (!currentStyle) return availableStyles;
  const currentFolderId = currentStyle.folder || null;
  return availableStyles.filter((style) => (style.folder || null) === currentFolderId);
};

export {
  buildFolderTree,
  flattenFolderTree,
  collectDescendantIds,
  getAutomaticTagStyles,
};
