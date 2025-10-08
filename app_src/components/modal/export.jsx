import React from "react";
import { FiX } from "react-icons/fi";
import { MdSave } from "react-icons/md";

import config from "../../config";
import { locale } from "../../utils";
import { useContext } from "../../context";

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

const collectDescendantIds = (folders, folderId) => {
  const ids = [];
  if (!folderId) return ids;
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift();
    const children = folders.filter((folder) => (folder.parentId || null) === current);
    children.forEach((child) => {
      ids.push(child.id);
      queue.push(child.id);
    });
  }
  return ids;
};

const ExportModal = React.memo(function ExportModal() {
  const context = useContext();
  const [selected, setSelected] = React.useState([]);
  const [withSettings, setWithSettings] = React.useState(true);
  const [allSelected, setAllSelected] = React.useState(false);
  const folderTree = React.useMemo(() => buildFolderTree(context.state.folders), [context.state.folders]);
  const allFolderIds = React.useMemo(() => context.state.folders.map((folder) => folder.id), [context.state.folders]);

  const close = () => {
    context.dispatch({ type: "setModal" });
  };

  const toggleFolder = (id, checked) => {
    const next = new Set(selected);
    const descendants = collectDescendantIds(context.state.folders, id);
    if (checked) {
      next.add(id);
      descendants.forEach((desc) => next.add(desc));
    } else {
      next.delete(id);
      descendants.forEach((desc) => next.delete(desc));
    }
    const arr = Array.from(next);
    setSelected(arr);
    setAllSelected(arr.length === allFolderIds.length);
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected([]);
      setAllSelected(false);
    } else {
      setSelected(allFolderIds);
      setAllSelected(true);
    }
  };

  const exportData = (e) => {
    e.preventDefault();
    if (!selected.length && !withSettings) return;
    const pathSelect = window.cep.fs.showSaveDialogEx(
      false,
      false,
      ["json"],
      config.exportFileName + ".json"
    );
    if (!pathSelect?.data) return false;
    const folders = context.state.folders.filter((f) => selected.includes(f.id));
    const styles = context.state.styles.filter((s) => selected.includes(s.folder));
    const data = {
      folders,
      styles,
      version: config.appVersion,
      exported: new Date(),
    };
    if (withSettings) {
      data.ignoreLinePrefixes = context.state.ignoreLinePrefixes;
      data.defaultStyleId = context.state.defaultStyleId;
      data.language = context.state.language;
      data.autoClosePSD = context.state.autoClosePSD;
      data.autoScrollStyle = context.state.autoScrollStyle;
      data.currentFolderTagPriority = context.state.currentFolderTagPriority;
      data.textItemKind = context.state.setTextItemKind;
    }
    window.cep.fs.writeFile(pathSelect.data, JSON.stringify(data));
    close();
  };

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.settingsExport}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <form className="app-modal-body-inner" onSubmit={exportData}>
            <div className="fields">
              <div className="export-select-all-container">
                <button 
                  type="button" 
                  className="topcoat-button--large" 
                  onClick={toggleSelectAll}
                >
                  {allSelected ? locale.deselectAll : locale.selectAll}
                </button>
              </div>
            {renderFolderNodes(folderTree, selected, toggleFolder)}
            <label className="topcoat-checkbox export-settings-item">
              <input
                type="checkbox"
                checked={withSettings}
                onChange={(e) => setWithSettings(e.target.checked)}
              />
              <div className="topcoat-checkbox__checkmark"></div>
              <div className="export-settings-title">{locale.exportIncludeSettings}</div>
            </label>
          </div>
          <div className="fields hostBrdTopContrast">
            <button type="submit" className="topcoat-button--large--cta">
              <MdSave size={18} /> {locale.save}
            </button>
          </div>
        </form>
      </div>
    </React.Fragment>
  );
});

const renderFolderNodes = (nodes, selected, toggleFolder, depth = 0) => {
  if (!nodes || !nodes.length) return null;
  return nodes.map((folder) => (
    <React.Fragment key={folder.id}>
      <label className={"topcoat-checkbox export-folder-item" + (depth ? " m-nested" : "")}> 
        <input
          type="checkbox"
          checked={selected.includes(folder.id)}
          onChange={(e) => toggleFolder(folder.id, e.target.checked)}
        />
        <div className="topcoat-checkbox__checkmark"></div>
        <div className="export-folder-title" style={{ paddingLeft: depth ? depth * 12 : 0 }}>{folder.name}</div>
      </label>
      {renderFolderNodes(folder.children || [], selected, toggleFolder, depth + 1)}
    </React.Fragment>
  ));
};

export default ExportModal;
