import { serializeStyle } from "../../librarySerialization";
import "./stylesBlock.scss";

import React from "react";
import deepClone from "../../deepClone";
import PropTypes from "prop-types";
import { FiArrowRightCircle, FiPlus, FiFolderPlus, FiChevronDown, FiChevronUp, FiCopy, FiClipboard, FiTrash2, FiPlusSquare, FiEye, FiEyeOff, FiMinus, FiInfo, FiX } from "react-icons/fi";
import { MdEdit, MdLock } from "react-icons/md";
import { CiExport } from "react-icons/ci";

import config from "../../config";
import { locale, nativeAlert, nativeConfirm, getActiveLayerText, setActiveLayerText, rgbToHex, getStyleObject, getUserFonts, refreshUserFonts } from "../../utils";
import { useContext } from "../../context";
import { buildFolderTree } from "../../folderUtils";
import { collectFontRefs, exportZipWithFonts } from "../../fontFileExport";
import { createFontPreviewRegistry, getFontPreviewFamily } from "../../fontPreview";
import { notePerfRender } from "../../perfDebug";
import { getStyleTextSize, normalizeStyleSizePresets } from "../../styleSizePresets";

const FontPreviewContext = React.createContext({ aliases: {}, css: "", revision: 0 });
const emptyIdSet = new Set();

const StylesBlock = React.memo(function StylesBlock() {
  notePerfRender("StylesBlock");
  const context = useContext((state) => ({
    styles: state.styles,
    folders: state.folders,
    currentStyle: state.currentStyle,
    exportFolderFontTipVisible: state.exportFolderFontTipVisible,
    exportFolderFontTipDismissed: state.exportFolderFontTipDismissed,
    showTips: state.showTips,
    openFolders: state.openFolders,
    currentStyleId: state.currentStyleId,
    direction: state.direction,
    showQuickStyleSize: state.showQuickStyleSize,
    styleSizeStep: state.styleSizeStep,
    styleSizeTipVisible: state.styleSizeTipVisible,
  }));
  const fontTextStyles = React.useMemo(
    () => (context.state.styles || []).map((style) => style.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {}),
    [context.state.styles]
  );
  const [installedFonts, setInstalledFonts] = React.useState(getUserFonts);
  const [copiedStyle, setCopiedStyle] = React.useState(null);
  const [styleContextMenu, setStyleContextMenu] = React.useState(null);

  const closeStyleContextMenu = React.useCallback(() => {
    setStyleContextMenu(null);
  }, []);

  const openStyleContextMenu = React.useCallback((e, style) => {
    e.preventDefault();
    e.stopPropagation();
    context.dispatch({ type: "setCurrentStyleId", id: style.id });
    setStyleContextMenu({ type: "style", style, folderId: style.folder || null, x: e.clientX, y: e.clientY });
  }, [context.dispatch]);

  const openFolderContextMenu = React.useCallback((e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    setStyleContextMenu({ type: "folder", folderId: folderId || null, x: e.clientX, y: e.clientY });
  }, []);

  React.useEffect(() => {
    if (!styleContextMenu) return undefined;
    const closeOnEscape = (e) => {
      if (e.key === "Escape") closeStyleContextMenu();
    };
    document.addEventListener("mousedown", closeStyleContextMenu);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeStyleContextMenu);
    window.addEventListener("resize", closeStyleContextMenu);
    return () => {
      document.removeEventListener("mousedown", closeStyleContextMenu);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeStyleContextMenu);
      window.removeEventListener("resize", closeStyleContextMenu);
    };
  }, [styleContextMenu, closeStyleContextMenu]);

  const copyContextStyle = React.useCallback(() => {
    if (!styleContextMenu?.style) return;
    setCopiedStyle(deepClone(styleContextMenu.style));
    closeStyleContextMenu();
  }, [styleContextMenu, closeStyleContextMenu]);

  const pasteContextStyle = React.useCallback(() => {
    if (!copiedStyle || !styleContextMenu) return;
    context.dispatch({
      type: "duplicateStyle",
      data: deepClone(copiedStyle),
      folderId: styleContextMenu.folderId,
    });
    closeStyleContextMenu();
  }, [copiedStyle, styleContextMenu, context.dispatch, closeStyleContextMenu]);

  const duplicateContextStyle = React.useCallback(() => {
    if (!styleContextMenu?.style) return;
    context.dispatch({ type: "duplicateStyle", data: styleContextMenu.style });
    closeStyleContextMenu();
  }, [styleContextMenu, context.dispatch, closeStyleContextMenu]);

  const deleteContextStyle = React.useCallback(() => {
    const styleId = styleContextMenu?.style?.id;
    if (!styleId) return;
    closeStyleContextMenu();
    nativeConfirm(locale.confirmDeleteStyle, locale.confirmTitle, (ok) => {
      if (ok) context.dispatch({ type: "deleteStyle", id: styleId });
    });
  }, [styleContextMenu, context.dispatch, closeStyleContextMenu]);

  // Fonts are fetched once at panel startup: enumerating app.fonts blocks
  // Photoshop, and refreshing on focus used to swallow clicks on style items
  React.useEffect(() => {
    refreshUserFonts((fonts) => {
      setInstalledFonts(fonts);
    });
  }, []);

  const registryRef = React.useRef(null);
  const fontPreviewRegistry = React.useMemo(() => {
    const next = createFontPreviewRegistry(installedFonts, fontTextStyles, 0);
    // Reuse the previous registry when the CSS is identical: a new object
    // would re-inject the <style> block and force a full style recalculation
    // on every style edit (e.g. each quick-size click)
    if (registryRef.current && registryRef.current.css === next.css) return registryRef.current;
    registryRef.current = next;
    return next;
  }, [installedFonts, fontTextStyles]);

  const stylesByFolder = React.useMemo(() => {
    const map = new Map();
    (context.state.styles || []).forEach((style) => {
      const key = style.folder || "__unsorted__";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(style);
    });
    return map;
  }, [context.state.styles]);
  const unsortedStyles = stylesByFolder.get("__unsorted__") || [];
  const folderTree = React.useMemo(() => buildFolderTree(context.state.folders), [context.state.folders]);
  const foldersById = React.useMemo(
    () => new Map((context.state.folders || []).map((folder) => [folder.id, folder])),
    [context.state.folders]
  );
  const currentStyleFolderId = context.state.currentStyle?.folder || null;
  const currentStylePath = React.useMemo(
    () => {
      const ids = new Set();
      let folderId = currentStyleFolderId;
      while (folderId && !ids.has(folderId)) {
        ids.add(folderId);
        folderId = foldersById.get(folderId)?.parentId || null;
      }
      return ids;
    },
    [currentStyleFolderId, foldersById]
  );
  const unsortedFolder = React.useMemo(() => ({ name: locale.noFolderTitle }), []);
  const hasContent = context.state.folders.length || context.state.styles.length;
  const showExportFontTip =
    context.state.exportFolderFontTipVisible &&
    !context.state.exportFolderFontTipDismissed &&
    context.state.showTips !== false;
  return (
    <FontPreviewContext.Provider value={fontPreviewRegistry}>
      <style type="text/css">{fontPreviewRegistry.css}</style>
      {showExportFontTip && (
        <div className="export-font-tip hostBrdBotContrast">
          <FiInfo size={14} className="export-font-tip-icon" />
          <span className="export-font-tip-text">
            {locale.exportFolderFontTip || "Tip: hold Ctrl while clicking Export folder to also bundle the fonts' .ttf/.otf files in a .zip."}
          </span>
          <button
            type="button"
            className="export-font-tip-dismiss"
            onClick={() => context.dispatch({ type: "hideExportFolderFontTip", dismiss: true })}
          >
            {locale.dontShowAgain || "Don't show again"}
          </button>
          <button
            type="button"
            className="export-font-tip-close"
            title={locale.close}
            onClick={() => context.dispatch({ type: "hideExportFolderFontTip" })}
          >
            <FiX size={14} />
          </button>
        </div>
      )}
      {context.state.showTips !== false && context.state.styleSizeTipVisible && (
        <div className="export-font-tip style-size-tip hostBrdBotContrast" role="status">
          <FiInfo size={14} className="export-font-tip-icon" />
          <span className="export-font-tip-text">
            {locale.styleSizeStepTip || "Tip: You can change the font size increment in Settings > Behavior > Styles, for example to 0.5 for finer adjustments."}
          </span>
          <button
            type="button"
            className="export-font-tip-close"
            title={locale.close}
            onClick={() => context.dispatch({ type: "hideStyleSizeTip" })}
          >
            <FiX size={14} />
          </button>
        </div>
      )}
      <div className="folders-list">
        {hasContent ? (
          <React.Fragment>
            {unsortedStyles.length > 0 && (
              <FolderItem
                data={unsortedFolder}
                depth={0}
                stylesByFolder={stylesByFolder}
                dispatch={context.dispatch}
                openFolders={context.state.openFolders}
                branchActiveStyleId={
                  currentStyleFolderId === null ? context.state.currentStyleId : null
                }
                currentStylePath={emptyIdSet}
                direction={context.state.direction}
                showQuickStyleSize={context.state.showQuickStyleSize}
                styleSizeStep={context.state.styleSizeStep}
                onOpenStyleContextMenu={openStyleContextMenu}
                onOpenFolderContextMenu={openFolderContextMenu}
              />
            )}
            <FolderTree
              folders={folderTree}
              parentId={null}
              depth={0}
              stylesByFolder={stylesByFolder}
              dispatch={context.dispatch}
              openFolders={context.state.openFolders}
              currentStyleId={context.state.currentStyleId}
              currentStylePath={currentStylePath}
              direction={context.state.direction}
              showQuickStyleSize={context.state.showQuickStyleSize}
              styleSizeStep={context.state.styleSizeStep}
              onOpenStyleContextMenu={openStyleContextMenu}
              onOpenFolderContextMenu={openFolderContextMenu}
            />
          </React.Fragment>
        ) : (
          <div className="styles-empty">
            <span>{locale.addStylesHint}</span>
          </div>
        )}
      </div>
      {styleContextMenu && (
        <div
          className="style-context-menu hostBgdLight hostBrdContrast"
          role="menu"
          style={{
            left: Math.max(4, Math.min(styleContextMenu.x, window.innerWidth - 196)),
            top: Math.max(4, Math.min(styleContextMenu.y, window.innerHeight - (styleContextMenu.type === "style" ? 146 : 42))),
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {styleContextMenu.type === "style" && (
            <button type="button" role="menuitem" onClick={copyContextStyle}>
              <FiCopy size={15} />
              <span>{locale.copyStyle}</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={pasteContextStyle} disabled={!copiedStyle}>
            <FiClipboard size={15} />
            <span>{locale.pasteStyle}</span>
          </button>
          {styleContextMenu.type === "style" && (
            <React.Fragment>
              <button type="button" role="menuitem" onClick={duplicateContextStyle}>
                <FiPlusSquare size={15} />
                <span>{locale.duplicateStyle}</span>
              </button>
              <div className="style-context-menu-separator hostBrdTopContrast" />
              <button type="button" role="menuitem" className="m-danger" onClick={deleteContextStyle}>
                <FiTrash2 size={15} />
                <span>{locale.delete}</span>
              </button>
            </React.Fragment>
          )}
        </div>
      )}
      <div className="style-add hostBrdTopContrast style-btn-list">
        <button className="topcoat-button--large" onClick={() => context.dispatch({ type: "setModal", modal: "editFolder", data: { create: true } })}>
          <FiFolderPlus size={18} /> {locale.addFolder}
        </button>
        <button className="topcoat-button--large" onClick={() => context.dispatch({ type: "setModal", modal: "editStyle", data: { create: true } })}>
          <FiPlus size={18} /> {locale.addStyle}
        </button>
      </div>
    </FontPreviewContext.Provider>
  );
});

const styleDragMime = "application/x-typer-style-id";
let currentDraggingStyleId = null;
const folderDragMime = "application/x-typer-folder-id";
let currentDraggingFolder = null;

const hasStyleDragData = (event) => {
  if (currentDraggingStyleId) return true;
  return Array.from(event.dataTransfer?.types || []).includes(styleDragMime);
};

const getDraggedStyleId = (event) => {
  return currentDraggingStyleId || event.dataTransfer.getData(styleDragMime) || event.dataTransfer.getData("text/plain");
};

const getStyleDropLocation = (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const list = event.currentTarget.parentElement;
  const listRect = list?.getBoundingClientRect();
  const isGrid = !!listRect && rect.width < listRect.width * 0.75;

  if (!isGrid) {
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    return { position, edge: position === "before" ? "top" : "bottom" };
  }

  const position = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  const sibling = position === "before"
    ? event.currentTarget.previousElementSibling
    : event.currentTarget.nextElementSibling;
  const siblingRect = sibling?.classList.contains("style-item")
    ? sibling.getBoundingClientRect()
    : null;
  const isSameRow = !!siblingRect && Math.abs(siblingRect.top - rect.top) < 2;

  return {
    position,
    edge: isSameRow
      ? (position === "before" ? "left" : "right")
      : (position === "before" ? "top" : "bottom"),
  };
};

const FolderTree = React.memo(function FolderTree(props) {
  if (!props.folders || !props.folders.length) return null;
  return (
    <div
      className={"folders-sortable" + (props.depth > 0 ? " m-nested" : "")}
    >
      {props.folders.map((folder) => (
        <FolderItem
          key={folder.id}
          data={folder}
          depth={props.depth}
          stylesByFolder={props.stylesByFolder}
          dispatch={props.dispatch}
          openFolders={props.openFolders}
          branchActiveStyleId={props.currentStylePath.has(folder.id) ? props.currentStyleId : null}
          currentStylePath={
            props.currentStylePath.has(folder.id) ? props.currentStylePath : emptyIdSet
          }
          direction={props.direction}
          showQuickStyleSize={props.showQuickStyleSize}
          styleSizeStep={props.styleSizeStep}
          siblingFolderIds={props.folders.map((item) => item.id)}
          parentId={props.parentId}
          onOpenStyleContextMenu={props.onOpenStyleContextMenu}
          onOpenFolderContextMenu={props.onOpenFolderContextMenu}
        />
      ))}
    </div>
  );
});
FolderTree.propTypes = {
  folders: PropTypes.array,
  parentId: PropTypes.oneOfType([PropTypes.string, PropTypes.oneOf([null])]),
  depth: PropTypes.number.isRequired,
  stylesByFolder: PropTypes.object.isRequired,
  dispatch: PropTypes.func.isRequired,
  openFolders: PropTypes.array.isRequired,
  currentStyleId: PropTypes.string,
  currentStylePath: PropTypes.object.isRequired,
  direction: PropTypes.string,
  showQuickStyleSize: PropTypes.bool,
  styleSizeStep: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onOpenStyleContextMenu: PropTypes.func.isRequired,
  onOpenFolderContextMenu: PropTypes.func.isRequired,
};

const FolderItem = React.memo(function FolderItem(props) {
  const [dropActive, setDropActive] = React.useState(false);
  const [styleDropTarget, setStyleDropTarget] = React.useState(null);
  const [folderDropEdge, setFolderDropEdge] = React.useState(null);
  const openFolder = React.useCallback((e) => {
    e.stopPropagation();
    props.dispatch({ type: "setModal", modal: "editFolder", data: props.data });
  }, [props.dispatch, props.data]);

  const handleDragOver = React.useCallback((e) => {
    if (currentDraggingFolder && props.data.id) {
      if (currentDraggingFolder.id === props.data.id || currentDraggingFolder.parentId !== props.parentId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      setFolderDropEdge(e.clientY < rect.top + rect.height / 2 ? "before" : "after");
      return;
    }
    if (!hasStyleDragData(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropActive(true);
    setStyleDropTarget(null);
  }, [props.data.id, props.parentId]);

  const handleDragLeave = React.useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropActive(false);
    setFolderDropEdge(null);
  }, []);

  const handleStyleDrop = React.useCallback((e) => {
    if (currentDraggingFolder && props.data.id) {
      if (currentDraggingFolder.id === props.data.id || currentDraggingFolder.parentId !== props.parentId) return;
      e.preventDefault();
      e.stopPropagation();
      const order = (props.siblingFolderIds || []).filter((id) => id !== currentDraggingFolder.id);
      const targetIndex = order.indexOf(props.data.id);
      const insertAt = folderDropEdge === "after" ? targetIndex + 1 : targetIndex;
      order.splice(Math.max(0, insertAt), 0, currentDraggingFolder.id);
      setFolderDropEdge(null);
      props.dispatch({ type: "reorderFolders", parentId: props.parentId, order });
      return;
    }
    if (!hasStyleDragData(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    setStyleDropTarget(null);
    const styleId = getDraggedStyleId(e);
    if (!styleId) return;
    props.dispatch({ type: "moveStyleToFolder", id: styleId, folderId: props.data.id || null });
  }, [props.dispatch, props.data.id, props.parentId, props.siblingFolderIds, folderDropEdge]);

  const startFolderDrag = React.useCallback((e) => {
    if (!props.data.id) return;
    currentDraggingFolder = { id: props.data.id, parentId: props.parentId || null };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(folderDragMime, props.data.id);
    e.stopPropagation();
  }, [props.data.id, props.parentId]);

  const endFolderDrag = React.useCallback(() => {
    currentDraggingFolder = null;
    setFolderDropEdge(null);
  }, []);

  const styles = props.stylesByFolder.get(props.data.id || "__unsorted__") || [];
  const childFolders = props.data.children || [];

  const getStyleOrder = React.useCallback(
    (draggedStyleId, targetStyleId, position) => {
      const order = styles.map((style) => style.id).filter((id) => id !== draggedStyleId);
      const targetIndex = order.indexOf(targetStyleId);
      if (targetIndex === -1) return order.concat(draggedStyleId);
      order.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggedStyleId);
      return order;
    },
    [styles]
  );

  const handleStyleItemDragOver = React.useCallback((e, targetStyleId) => {
    if (!hasStyleDragData(e)) return;
    const draggedStyleId = getDraggedStyleId(e);
    if (!draggedStyleId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropActive(true);
    if (draggedStyleId === targetStyleId) {
      setStyleDropTarget(null);
      return;
    }
    const location = getStyleDropLocation(e);
    setStyleDropTarget({ id: targetStyleId, ...location });
  }, []);

  const handleStyleItemDrop = React.useCallback(
    (e, targetStyleId) => {
      if (!hasStyleDragData(e)) return;
      const draggedStyleId = getDraggedStyleId(e);
      if (!draggedStyleId) return;
      e.preventDefault();
      e.stopPropagation();
      if (draggedStyleId === targetStyleId) {
        setDropActive(false);
        setStyleDropTarget(null);
        return;
      }
      const { position } = getStyleDropLocation(e);
      setDropActive(false);
      setStyleDropTarget(null);
      props.dispatch({
        type: "moveStyleToFolder",
        id: draggedStyleId,
        folderId: props.data.id || null,
        order: getStyleOrder(draggedStyleId, targetStyleId, position),
      });
    },
    [props.dispatch, getStyleOrder, props.data.id]
  );

  const clearStyleDropTarget = React.useCallback((e) => {
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    setStyleDropTarget(null);
  }, []);

  const exportFolder = React.useCallback((e) => {
    e.stopPropagation();
    // Ctrl/Cmd+Click also bundles the folder's font files into a .zip
    const withFonts = e.ctrlKey || e.metaKey;
    const ext = withFonts ? "zip" : "json";
    const pathSelect = window.cep.fs.showSaveDialogEx(false, false, [ext], props.data.name + "." + ext);
    if (!pathSelect?.data) return false;
    const exportedFolder = {};
    exportedFolder.name = props.data.name;
    const exportedStyles = styles.map((style) => ({
      ...serializeStyle(style),
      name: style.name,
      textType: style.textType || "inherit",
      textProps: style.textProps,
      prefixes: style.prefixes || [],
      prefixColor: style.prefixColor,
      stroke: style.stroke,
    }));
    exportedFolder.exportedStyles = exportedStyles;
    if (withFonts) {
      const result = exportZipWithFonts({
        zipPath: pathSelect.data,
        jsonFileName: props.data.name + ".json",
        jsonString: JSON.stringify(exportedFolder),
        fontRefs: collectFontRefs(styles),
      });
      if (!result.ok) {
        nativeAlert(locale.exportFontFilesError || "Could not create the .zip archive.", locale.errorTitle, true);
        return false;
      }
      if (result.missing.length) {
        nativeAlert(
          (locale.exportFontFilesMissing || "These fonts could not be found on this computer and were not added to the archive:") +
            "\n" + result.missing.join("\n"),
          locale.errorTitle,
          true
        );
      }
      return;
    }
    const written = window.cep.fs.writeFile(pathSelect.data, JSON.stringify(exportedFolder));
    if (!written || written.err) { nativeAlert(locale.saveError, locale.errorTitle, true); return; }
    // Plain export done: surface the Ctrl+Click zip shortcut once in a while
    props.dispatch({ type: "showExportFolderFontTip" });
  }, [props.data.name, styles, props.dispatch]);

  const duplicateFolder = React.useCallback((e) => {
    e.stopPropagation();
    props.dispatch({ type: "duplicateFolder", id: props.data.id });
  }, [props.dispatch, props.data.id]);

  const addSubfolder = React.useCallback((e) => {
    e.stopPropagation();
    props.dispatch({ type: "setModal", modal: "editFolder", data: { create: true, parentId: props.data.id } });
  }, [props.dispatch, props.data.id]);

  const toggleFolder = React.useCallback(() => {
    props.dispatch({ type: "toggleFolder", id: props.data.id });
  }, [props.dispatch, props.data.id]);

  const isOpen = props.data.id
    ? props.openFolders.includes(props.data.id)
    : props.openFolders.includes("unsorted");
  const hasActive = props.branchActiveStyleId
    ? styles.some((style) => style.id === props.branchActiveStyleId)
    : false;
  return (
    <div
      className={
        "folder-item hostBrdContrast" +
        (isOpen ? " m-open" : "") +
        (props.depth ? " m-nested" : "") +
        (dropActive ? " m-drop-active" : "") +
        (folderDropEdge ? " m-folder-drop-" + folderDropEdge : "")
      }
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleStyleDrop}
    >
      <div
        className="folder-header"
        style={{ paddingLeft: props.depth ? props.depth * 12 + 4 : 4 }}
        onClick={toggleFolder}
        onContextMenu={(e) => props.onOpenFolderContextMenu(e, props.data.id || null)}
        draggable={!!props.data.id}
        onDragStart={startFolderDrag}
        onDragEnd={endFolderDrag}
      >
        <div className="folder-marker">{isOpen ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}</div>
        <div className="folder-title">
          {hasActive ? <strong>{props.data.name}</strong> : <span>{props.data.name}</span>}
          <em className="folder-styles-count">({styles.length})</em>
        </div>
        <div className="folder-actions">
          {props.data.id ? (
            <>
              <button className="topcoat-icon-button--large--quiet" title={locale.addSubfolder || "Add subfolder"} onClick={addSubfolder}>
                <FiFolderPlus size={14} />
              </button>
              <button className="topcoat-icon-button--large--quiet" title={locale.exportFolder + " (" + (locale.exportFolderZipHint || "Ctrl+Click: .zip with font files") + ")"} onClick={exportFolder}>
                <CiExport size={14} />
              </button>
              <button className="topcoat-icon-button--large--quiet" title={locale.editFolder} onClick={openFolder}>
                <MdEdit size={14} />
              </button>
              <button className="topcoat-icon-button--large--quiet" title={locale.duplicateFolder} onClick={duplicateFolder}>
                <FiCopy size={14} />
              </button>
            </>
          ) : (
            <MdLock size={18} className="folder-locked" />
          )}
        </div>
      </div>
      {isOpen && (
        <div className="folder-content">
          {!!childFolders.length && props.data.id && (
            <div className="folder-subfolders hostBrdTopContrast">
              <FolderTree
                folders={childFolders}
                parentId={props.data.id}
                depth={props.depth + 1}
                stylesByFolder={props.stylesByFolder}
                dispatch={props.dispatch}
                openFolders={props.openFolders}
                currentStyleId={props.branchActiveStyleId}
                currentStylePath={props.currentStylePath}
                direction={props.direction}
                showQuickStyleSize={props.showQuickStyleSize}
                styleSizeStep={props.styleSizeStep}
                onOpenStyleContextMenu={props.onOpenStyleContextMenu}
                onOpenFolderContextMenu={props.onOpenFolderContextMenu}
              />
            </div>
          )}
          <div className={"folder-styles hostBrdTopContrast" + (childFolders.length && props.data.id ? " m-with-subfolders" : "")}>
            <div className={"styles-list" + (!styles.length ? " m-empty" : "")}>
              {styles.map((style) => (
                <StyleItem
                  key={style.id}
                  active={props.branchActiveStyleId === style.id}
                  dropEdge={styleDropTarget?.id === style.id ? styleDropTarget.edge : null}
                  onDragOverStyle={handleStyleItemDragOver}
                  onDropStyle={handleStyleItemDrop}
                  onDragLeaveStyle={clearStyleDropTarget}
                  style={style}
                  dispatch={props.dispatch}
                  direction={props.direction}
                  showQuickStyleSize={props.showQuickStyleSize}
                  styleSizeStep={props.styleSizeStep}
                  onOpenContextMenu={props.onOpenStyleContextMenu}
                />
              ))}
              {!styles.length && (
                <div className="folder-styles-empty">
                  <span>{locale.noStylesInFolder}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
FolderItem.propTypes = {
  data: PropTypes.object.isRequired,
  depth: PropTypes.number.isRequired,
  stylesByFolder: PropTypes.object.isRequired,
  dispatch: PropTypes.func.isRequired,
  openFolders: PropTypes.array.isRequired,
  branchActiveStyleId: PropTypes.string,
  currentStylePath: PropTypes.object.isRequired,
  direction: PropTypes.string,
  showQuickStyleSize: PropTypes.bool,
  styleSizeStep: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  siblingFolderIds: PropTypes.array,
  parentId: PropTypes.oneOfType([PropTypes.string, PropTypes.oneOf([null])]),
  onOpenStyleContextMenu: PropTypes.func.isRequired,
  onOpenFolderContextMenu: PropTypes.func.isRequired,
};

// StyleItem deliberately avoids useContext: subscribing to the global context
// would re-render every style item on every dispatch (each keystroke, each
// line change). Everything it needs arrives through identity-stable props so
// React.memo can actually skip it.
const StyleItem = React.memo(function StyleItem(props) {
  const layerText = props.style.textProps?.layerText || {};
  const textStyle = layerText.textStyleRange?.[0]?.textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const fontPreviewRegistry = React.useContext(FontPreviewContext);
  const prefixes = props.style.prefixes || [];
  const dispatch = props.dispatch;

  const unit = props.style.textProps?.typeUnit ? props.style.textProps.typeUnit.substr(0, 3) : "px";
  const showQuickStyleSize = props.showQuickStyleSize !== false;
  const sizePresets = normalizeStyleSizePresets(props.style);
  const activeSize = getStyleTextSize(props.style);
  const [quickSizeOverride, setQuickSizeOverride] = React.useState(null);
  const [quickOpen, setQuickOpen] = React.useState(false);
  const quickCloseTimeout = React.useRef(null);
  const quickWrapRef = React.useRef(null);
  const displaySize = quickSizeOverride !== null ? quickSizeOverride : (activeSize || "");
  const sizeStep = Number(props.styleSizeStep) > 0 ? Number(props.styleSizeStep) : 1;
  const sizeStepDecimals = (sizeStep.toString().split(".")[1] || "").length;

  React.useEffect(() => () => {
    if (quickCloseTimeout.current) clearTimeout(quickCloseTimeout.current);
  }, []);

  // StyleItem now handles its own select/open dispatch instead of receiving closures as props
  const selectStyle = React.useCallback(() => {
    dispatch({ type: "setCurrentStyleId", id: props.style.id });
  }, [dispatch, props.style.id]);

  const openStyle = React.useCallback((e) => {
    e.stopPropagation();
    dispatch({ type: "setModal", modal: "editStyle", data: props.style });
  }, [dispatch, props.style]);

  const insertStyle = React.useCallback((e) => {
    e.stopPropagation();
    const direction = props.direction;
    if (e.ctrlKey) {
      getActiveLayerText((data) => {
        const activeTextStyle = data?.textProps?.layerText?.textStyleRange?.[0]?.textStyle;
        if (!activeTextStyle?.size) return;
        const styleWithActiveSize = deepClone(props.style);
        const nextTextStyle = styleWithActiveSize.textProps?.layerText?.textStyleRange?.[0]?.textStyle;
        if (!nextTextStyle) return;
        nextTextStyle.size = activeTextStyle.size;
        styleWithActiveSize.autoSizeByPageWidth = false;
        setActiveLayerText("", styleWithActiveSize, direction);
      });
    } else {
      setActiveLayerText("", props.style, direction);
    }
  }, [props.direction, props.style]);

  const togglePrefixes = React.useCallback((e) => {
    e.stopPropagation();
    dispatch({ type: "toggleStylePrefixes", id: props.style.id });
  }, [dispatch, props.style.id]);

  const selectSizePreset = (size) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!props.active) dispatch({ type: "setCurrentStyleId", id: props.style.id });
    dispatch({ type: "setStyleSizePreset", id: props.style.id, size });
  };

  const openQuickSize = () => {
    if (quickCloseTimeout.current) clearTimeout(quickCloseTimeout.current);
    setQuickOpen(true);
  };
  const scheduleCloseQuickSize = () => {
    if (quickCloseTimeout.current) clearTimeout(quickCloseTimeout.current);
    quickCloseTimeout.current = setTimeout(() => setQuickOpen(false), 150);
    if (quickWrapRef.current && quickWrapRef.current.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  };
  const stopQuickEvent = (e) => e.stopPropagation();
  const applyQuickSize = (value) => {
    const size = parseFloat(value);
    if (!Number.isFinite(size) || size <= 0) return;
    dispatch({ type: "updateActiveStyleSizePreset", id: props.style.id, size });
  };
  const changeQuickSize = (e) => {
    stopQuickEvent(e);
    const value = e.target.value;
    setQuickSizeOverride(value);
    if (value !== "") applyQuickSize(value);
  };
  const nudgeQuickSize = (delta) => (e) => {
    stopQuickEvent(e);
    const baseValue = parseFloat(quickSizeOverride ?? activeSize ?? 1);
    const rounded = Math.round((baseValue + delta * sizeStep) / sizeStep) * sizeStep;
    const nextValue = Math.max(1, parseFloat(rounded.toFixed(sizeStepDecimals)));
    setQuickSizeOverride(nextValue);
    applyQuickSize(nextValue);
  };
  const startDrag = React.useCallback((e) => {
    currentDraggingStyleId = props.style.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(styleDragMime, props.style.id);
    e.dataTransfer.setData("text/plain", props.style.id);
    const preview = document.createElement("div");
    preview.className = "style-drag-preview";
    const color = document.createElement("span");
    color.className = "style-drag-preview-color";
    color.style.background = rgbToHex(textStyle.color);
    const name = document.createElement("span");
    name.textContent = props.style.name;
    preview.appendChild(color);
    preview.appendChild(name);
    document.body.appendChild(preview);
    e.dataTransfer.setDragImage(preview, 12, 14);
    window.setTimeout(() => {
      if (preview.parentNode) preview.parentNode.removeChild(preview);
    }, 0);
  }, [props.style.id, props.style.name, textStyle.color]);

  const endDrag = React.useCallback(() => {
    currentDraggingStyleId = null;
  }, []);

  const dragOverStyle = React.useCallback(
    (e) => {
      props.onDragOverStyle(e, props.style.id);
    },
    [props.onDragOverStyle, props.style.id]
  );

  const dropStyle = React.useCallback(
    (e) => {
      props.onDropStyle(e, props.style.id);
    },
    [props.onDropStyle, props.style.id]
  );

  return (
    <div
      id={props.style.id}
      className={
        "style-item hostBgdLight" +
        (props.active ? " m-current" : "") +
        (props.style.prefixesDisabled ? " m-disabled" : "") +
        (props.dropEdge ? " m-drop-" + props.dropEdge : "")
      }
      draggable
      onDragStart={startDrag}
      onDragEnd={endDrag}
      onDragOver={dragOverStyle}
      onDragLeave={props.onDragLeaveStyle}
      onDrop={dropStyle}
      onClick={selectStyle}
      onContextMenu={(e) => props.onOpenContextMenu(e, props.style)}
    >
      {props.dropEdge && <span className={"style-drop-indicator m-" + props.dropEdge} aria-hidden="true" />}
      <div className="style-marker">
        <div className="style-color" style={{ background: rgbToHex(textStyle.color) }} title={locale.styleTextColor + ": " + rgbToHex(textStyle.color)}></div>
        {!!prefixes.length && (
          <div className="style-prefix-color" title={locale.stylePrefixColor + ": " + (props.style.prefixColor || config.defaultPrefixColor)}>
            <div style={{ background: props.style.prefixColor || config.defaultPrefixColor }}></div>
          </div>
        )}
        {!!prefixes.length && (
          <div className="style-prefix-toggle" onClick={togglePrefixes} title={props.style.prefixesDisabled ? locale.enableStylePrefixes : locale.disableStylePrefixes}>
            {props.style.prefixesDisabled ? <FiEyeOff size={10} /> : <FiEye size={10} />}
          </div>
        )}
      </div>
      <div className="style-name" style={styleObject}>
        <span
          key={fontPreviewRegistry.revision}
          style={{ fontFamily: getFontPreviewFamily(textStyle, fontPreviewRegistry) }}
        >
          {props.style.name}
        </span>
      </div>
      <div className="style-actions">
        {showQuickStyleSize && sizePresets.length > 0 && (
          <div className="style-size-presets" aria-label={locale.editStyleSizePresetsLabel || "Text size presets"}>
            {sizePresets.map((size) => (
              <button
                type="button"
                key={size}
                className={"style-size-preset" + (size === activeSize ? " m-active" : "")}
                title={`${locale.editStyleActivateSizePreset || "Use this size preset"}: ${size}${unit}`}
                onClick={selectSizePreset(size)}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {size}<span>{unit}</span>
              </button>
            ))}
          </div>
        )}
        {showQuickStyleSize ? (
          <div
            className={"style-quick-size-wrap" + (quickOpen ? " m-open" : "")}
            ref={quickWrapRef}
            onMouseEnter={openQuickSize}
            onMouseLeave={scheduleCloseQuickSize}
            onFocus={openQuickSize}
            onBlur={scheduleCloseQuickSize}
            onMouseDown={stopQuickEvent}
            onClick={stopQuickEvent}
          >
            <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.editStyle} onClick={openStyle}>
              <MdEdit size={16} />
            </button>
            <div className="style-quick-size hostBrdContrast" title={locale.editStyleFontSize || "Font size"}>
              <button type="button" className="style-quick-size-btn" title={locale.shortcut_decrease || "Decrease text size"} onClick={nudgeQuickSize(-1)}>
                <FiMinus size={12} />
              </button>
              <input
                type="number"
                min={1}
                step={sizeStep}
                value={displaySize}
                onChange={changeQuickSize}
                onBlur={() => setQuickSizeOverride(null)}
                className="style-quick-size-input"
              />
              <button type="button" className="style-quick-size-btn" title={locale.shortcut_increase || "Increase text size"} onClick={nudgeQuickSize(1)}>
                <FiPlus size={12} />
              </button>
            </div>
          </div>
        ) : (
          <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.editStyle} onClick={openStyle}>
            <MdEdit size={16} />
          </button>
        )}
        <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.insertStyle} onClick={insertStyle}>
          <FiArrowRightCircle size={16} />
        </button>
      </div>
    </div>
  );
});
StyleItem.propTypes = {
  style: PropTypes.object.isRequired,
  active: PropTypes.bool,
  dropEdge: PropTypes.oneOf(["top", "right", "bottom", "left"]),
  onDragOverStyle: PropTypes.func.isRequired,
  onDropStyle: PropTypes.func.isRequired,
  onDragLeaveStyle: PropTypes.func.isRequired,
  dispatch: PropTypes.func.isRequired,
  direction: PropTypes.string,
  showQuickStyleSize: PropTypes.bool,
  styleSizeStep: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onOpenContextMenu: PropTypes.func.isRequired,
};

export default StylesBlock;
