import "./tabBar.scss";

import React from "react";
import { FiPlus, FiX, FiAlertTriangle } from "react-icons/fi";

import { locale } from "../../utils";
import { useContext } from "../../context";

const tabDragMime = "application/x-typer-tab";

// The gap under the cursor, in the order of the tabs: the strip runs from
// right to left in Arabic
const getTabDropSlot = (list, clientX) => {
  const rtl = document.documentElement.getAttribute("dir") === "rtl";
  const tabNodes = list.querySelectorAll(".tab-bar-tab");
  for (let i = 0; i < tabNodes.length; i++) {
    const rect = tabNodes[i].getBoundingClientRect();
    const middle = rect.left + rect.width / 2;
    if (rtl ? clientX > middle : clientX < middle) return i;
  }
  return tabNodes.length;
};

const TabBar = React.memo(function TabBar() {
  const context = useContext((state) => ({
    tabs: state.tabs,
    currentTabId: state.currentTabId,
    multiTabEnabled: state.multiTabEnabled,
  }));
  const tabs = context.state.tabs || [];
  const currentTabId = context.state.currentTabId;
  const [editingId, setEditingId] = React.useState(null);
  const [editingName, setEditingName] = React.useState("");
  const inputRef = React.useRef(null);
  // The input can blur while it unmounts after Enter/Escape; this ref makes
  // sure a cancelled rename is not saved and a committed one is sent once.
  const renameClosedRef = React.useRef(false);

  React.useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (tab) => {
    renameClosedRef.current = false;
    setEditingId(tab.id);
    setEditingName(tab.name);
  };

  const commitRename = () => {
    if (renameClosedRef.current) return;
    renameClosedRef.current = true;
    if (editingId) {
      context.dispatch({ type: "renameTab", id: editingId, name: editingName });
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") {
      renameClosedRef.current = true;
      setEditingId(null);
    }
  };

  const selectTab = (tab) => {
    if (tab.id !== currentTabId) {
      context.dispatch({ type: "switchTab", id: tab.id });
    }
  };

  const [closingTab, setClosingTab] = React.useState(null);

  const closeTab = (e, tab) => {
    e.stopPropagation();
    const hasContent = (tab.text || "").trim() || (tab.images || []).length;
    if (hasContent) {
      setClosingTab(tab);
      return;
    }
    context.dispatch({ type: "deleteTab", id: tab.id });
  };

  const confirmCloseTab = () => {
    if (closingTab) context.dispatch({ type: "deleteTab", id: closingTab.id });
    setClosingTab(null);
  };

  const [draggingId, setDraggingId] = React.useState(null);
  const [dropSlot, setDropSlot] = React.useState(null);

  const startTabDrag = (e, tab) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(tabDragMime, tab.id);
    setDraggingId(tab.id);
  };

  const endTabDrag = () => {
    setDraggingId(null);
    setDropSlot(null);
  };

  const dragOverTabs = (e) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const slot = getTabDropSlot(e.currentTarget, e.clientX);
    const from = tabs.findIndex((tab) => tab.id === draggingId);
    // The two gaps around the dragged tab would leave it in place
    setDropSlot(slot === from || slot === from + 1 ? null : slot);
  };

  const dragLeaveTabs = (e) => {
    // WebKit leaves relatedTarget empty, so only the position tells a real
    // exit from a move onto the next tab
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) return;
    setDropSlot(null);
  };

  const dropTab = (e) => {
    if (!draggingId) return;
    e.preventDefault();
    context.dispatch({ type: "moveTab", id: draggingId, slot: getTabDropSlot(e.currentTarget, e.clientX) });
    endTabDrag();
  };

  const addTab = () => {
    context.dispatch({ type: "addTab" });
    context.dispatch({ type: "showFeatureTip", id: "renameTab" });
  };

  if (context.state.multiTabEnabled === false) return null;

  return (
    <div className="tab-bar hostBgdDark">
      <div className="tab-bar-list" onDragOver={dragOverTabs} onDragLeave={dragLeaveTabs} onDrop={dropTab}>
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={
              "tab-bar-tab" +
              (tab.id === currentTabId ? " m-active hostBgdLight" : "") +
              (tab.id === draggingId ? " m-dragging" : "") +
              (dropSlot === index ? " m-drop-before" : "") +
              (dropSlot === tabs.length && index === tabs.length - 1 ? " m-drop-after" : "")
            }
            data-tour-tab={tab.id}
            draggable={tabs.length > 1 && editingId !== tab.id}
            onDragStart={(e) => startTabDrag(e, tab)}
            onDragEnd={endTabDrag}
            onClick={() => selectTab(tab)}
            onDoubleClick={() => startRename(tab)}
            title={locale.tabRenameHint || "Double-click to rename, drag to reorder"}
          >
            {(tab.images || []).length ? (
              <span className="tab-bar-sync-dot" title={locale.tabSynced || "PSDs are synced to this tab"} />
            ) : null}
            {editingId === tab.id ? (
              <input
                ref={inputRef}
                className="tab-bar-rename-input"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tab-bar-name">{tab.name}</span>
            )}
            {tabs.length > 1 && (
              <span className="tab-bar-close" title={locale.tabClose || "Close tab"} onClick={(e) => closeTab(e, tab)}>
                <FiX size={11} />
              </span>
            )}
          </div>
        ))}
        <button type="button" className="tab-bar-add" title={locale.tabAdd || "New tab"} onClick={addTab}>
          <FiPlus size={12} />
        </button>
      </div>
      {closingTab && (
        <div className="settings-confirm-overlay" onClick={() => setClosingTab(null)}>
          <div className="settings-confirm-dialog hostBgdLight" onClick={(e) => e.stopPropagation()}>
            <div className="settings-confirm-icon">
              <FiAlertTriangle size={26} />
            </div>
            <div className="settings-confirm-title">
              {(locale.tabCloseConfirmTitle || 'Close "{name}"?').replace("{name}", closingTab.name)}
            </div>
            <div className="settings-confirm-text">
              {locale.tabCloseConfirm || "Its text and PSD sync will be lost."}
            </div>
            <div className="settings-confirm-actions">
              <button type="button" className="topcoat-button--large" onClick={() => setClosingTab(null)}>
                {locale.cancel || "Cancel"}
              </button>
              <button type="button" className="topcoat-button--large--cta settings-confirm-danger" onClick={confirmCloseTab}>
                {locale.tabClose || "Close tab"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default TabBar;
