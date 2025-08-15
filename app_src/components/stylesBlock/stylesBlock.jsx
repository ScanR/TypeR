import "./stylesBlock.scss";

import React from "react";
import PropTypes from "prop-types";
import { ReactSortable } from "react-sortablejs";
import { FiArrowRightCircle, FiPlus, FiFolderPlus, FiChevronDown, FiChevronUp, FiCopy, FiEye, FiEyeOff } from "react-icons/fi";
import { MdEdit, MdLock } from "react-icons/md";
import { CiExport } from "react-icons/ci";

import config from "../../config";
import { locale, getActiveLayerText, setActiveLayerText, rgbToHex, getStyleObject } from "../../utils";
import { useContext } from "../../context";

const StylesBlock = React.memo(function StylesBlock() {
  const context = useContext();
  const unsortedStyles = context.state.styles.filter((s) => !s.folder);
  return (
    <React.Fragment>
      <div className="folders-list">
        {context.state.folders.length || context.state.styles.length ? (
          <React.Fragment>
            {unsortedStyles.length > 0 && <FolderItem data={{ name: locale.noFolderTitle }} />}
            <ReactSortable className="folders-sortable" list={context.state.folders} setList={(data) => context.dispatch({ type: "setFolders", data })}>
              {context.state.folders.map((folder) => (
                <FolderItem key={folder.id} data={folder} />
              ))}
            </ReactSortable>
          </React.Fragment>
        ) : (
          <div className="styles-empty">
            <span>{locale.addStylesHint}</span>
          </div>
        )}
      </div>
      <div className="style-add hostBrdTopContrast style-btn-list">
        <button className="topcoat-button--large" onClick={() => context.dispatch({ type: "setModal", modal: "editFolder", data: { create: true } })}>
          <FiFolderPlus size={18} /> {locale.addFolder}
        </button>
        <button className="topcoat-button--large" onClick={() => context.dispatch({ type: "setModal", modal: "editStyle", data: { create: true } })}>
          <FiPlus size={18} /> {locale.addStyle}
        </button>
      </div>
    </React.Fragment>
  );
});

const FolderItem = React.memo(function FolderItem(props) {
  const context = useContext();
  const openFolder = (e) => {
    e.stopPropagation();
    context.dispatch({ type: "setModal", modal: "editFolder", data: props.data });
  };
  const sortFolderStyles = (folderStyles) => {
    let styles = props.data.id ? context.state.styles.filter((s) => s.folder !== props.data.id) : context.state.styles.filter((s) => !!s.folder);
    styles = styles.concat(folderStyles);
    context.dispatch({ type: "setStyles", data: styles });
  };
  const styles = props.data.id ? context.state.styles.filter((s) => s.folder === props.data.id) : context.state.styles.filter((s) => !s.folder);

  const exportFolder = (e) => {
    e.stopPropagation();
    const pathSelect = window.cep.fs.showSaveDialogEx(false, false, ["json"], props.data.name + ".json");
    if (!pathSelect?.data) return false;
    const exportedFolder = {};
    exportedFolder.name = props.data.name;
    const exportedStyles = [];
    exportedStyles.push(
      ...styles.map((style) => {
        return {
          name: style.name,
          textProps: style.textProps,
          prefixes: style.prefixes,
          prefixColor: style.prefixColor,
          stroke: style.stroke,
        };
      })
    );
    exportedFolder.exportedStyles = exportedStyles;

    window.cep.fs.writeFile(pathSelect.data, JSON.stringify(exportedFolder));
  };
  const duplicateFolder = (e) => {
    e.stopPropagation();
    context.dispatch({ type: "duplicateFolder", data: props.data });
  };

  const isOpen = props.data.id ? context.state.openFolders.includes(props.data.id) : context.state.openFolders.includes("unsorted");
  const hasActive = context.state.currentStyleId ? !!styles.find((s) => s.id === context.state.currentStyleId) : false;
  return (
    <div className={"folder-item hostBrdContrast" + (isOpen ? " m-open" : "")}>
      <div className="folder-header" onClick={() => context.dispatch({ type: "toggleFolder", id: props.data.id })}>
        <div className="folder-marker">{isOpen ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}</div>
        <div className="folder-title">
          {hasActive ? <strong>{props.data.name}</strong> : <span>{props.data.name}</span>}
          <em className="folder-styles-count">({styles.length})</em>
        </div>
        <div className="folder-actions">
          {props.data.id ? (
            <>
              <button className="topcoat-icon-button--large--quiet" title={locale.exportFolder} onClick={exportFolder}>
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
        <div className="folder-styles hostBrdTopContrast">
          {styles.length ? (
            <ReactSortable className="styles-list" list={styles} setList={sortFolderStyles}>
              {styles.map((style) => (
                <StyleItem key={style.id} active={context.state.currentStyleId === style.id} selectStyle={() => context.dispatch({ type: "setCurrentStyleId", id: style.id })} openStyle={() => context.dispatch({ type: "setModal", modal: "editStyle", data: style })} style={style} />
              ))}
            </ReactSortable>
          ) : (
            <div className="folder-styles-empty">
              <span>{locale.noStylesInFolder}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
FolderItem.propTypes = {
  data: PropTypes.object.isRequired,
};

const StyleItem = React.memo(function StyleItem(props) {
  const textStyle = props.style.textProps.layerText.textStyleRange[0]?.textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const context = useContext();
  const openStyle = (e) => {
    e.stopPropagation();
    props.openStyle();
  };
  const insertStyle = (e) => {
    e.stopPropagation();
    if (e.ctrlKey) {
      getActiveLayerText((data) => {
        textStyle.size = data.textProps.layerText.textStyleRange[0].textStyle.size;
        setActiveLayerText("", props.style);
      });
    } else {
      setActiveLayerText("", props.style);
    }
  };
  const duplicateStyle = (e) => {
    e.stopPropagation();
    context.dispatch({ type: "duplicateStyle", data: props.style });
  };
  const togglePrefixes = (e) => {
    e.stopPropagation();
    context.dispatch({ type: "toggleStylePrefixes", id: props.style.id });
  };
  return (
    <div id={props.style.id} className={"style-item hostBgdLight" + (props.active ? " m-current" : "") + (props.style.prefixesDisabled ? " m-disabled" : "")} onClick={props.selectStyle}>
      <div className="style-marker">
        <div className="style-color" style={{ background: rgbToHex(textStyle.color) }} title={locale.styleTextColor + ": " + rgbToHex(textStyle.color)}></div>
        {!!props.style.prefixes.length && (
          <div className="style-prefix-color" title={locale.stylePrefixColor + ": " + (props.style.prefixColor || config.defaultPrefixColor)}>
            <div style={{ background: props.style.prefixColor || config.defaultPrefixColor }}></div>
          </div>
        )}
        {!!props.style.prefixes.length && (
          <div className="style-prefix-toggle" onClick={togglePrefixes} title={props.style.prefixesDisabled ? "Activer les préfixes automatiques" : "Désactiver les préfixes automatiques"}>
            {props.style.prefixesDisabled ? <FiEyeOff size={10} /> : <FiEye size={10} />}
          </div>
        )}
      </div>
      <div className="style-name" style={styleObject} dangerouslySetInnerHTML={{ __html: `<span style='font-family: "${styleObject.fontFamily || "Tahoma"}"'>${props.style.name}</span>` }}></div>
      <div className="style-actions">
        <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.editStyle} onClick={openStyle}>
          <MdEdit size={16} />
        </button>
        <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.duplicateStyle} onClick={duplicateStyle}>
          <FiCopy size={16} />
        </button>
        <button className={"topcoat-icon-button--large--quiet" + (props.active ? " m-cta" : "")} title={locale.insertStyle} onClick={insertStyle}>
          <FiArrowRightCircle size={16} />
        </button>
      </div>
    </div>
  );
});
StyleItem.propTypes = {
  selectStyle: PropTypes.func.isRequired,
  openStyle: PropTypes.func.isRequired,
  style: PropTypes.object.isRequired,
  active: PropTypes.bool,
};

export default StylesBlock;
