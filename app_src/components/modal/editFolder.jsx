import './editFolder.scss';

import React from 'react';
import PropTypes from 'prop-types';
import {FiX} from "react-icons/fi";
import {MdDelete, MdCancel, MdSave} from "react-icons/md";

import {locale, nativeAlert, nativeConfirm, getStyleObject, rgbToHex} from '../../utils';
import {useContext} from '../../context';
import {buildFolderTree, flattenFolderTree, collectDescendantIds} from '../../folderUtils';
import FontScanPromo from './fontScanPromo';
import UnsavedChangesDialog from './unsavedChangesDialog';

const EditFolderModal = React.memo(function EditFolderModal() {
    const context = useContext((state) => ({
        modalData: state.modalData,
        styles: state.styles,
        folders: state.folders,
    }));
    const currentData = context.state.modalData;
    const folderStyleIds = currentData.id ? context.state.styles.filter(s => (s.folder === currentData.id)).map(s => s.id) : [];
    const [name, setName] = React.useState(currentData.name || '');
    const [styleIds, setStyleIds] = React.useState(folderStyleIds);
    const [deleteStyles, setDeleteStyles] = React.useState(false);
    const [edited, setEdited] = React.useState(false);
    const [discardConfirmOpen, setDiscardConfirmOpen] = React.useState(false);
    const initialParentId = React.useMemo(() => {
        if (currentData.parentId === null) return '';
        if (currentData.hasOwnProperty('parentId')) return currentData.parentId || '';
        if (currentData.parentFolderId) return currentData.parentFolderId;
        if (currentData.parentFolder) return currentData.parentFolder;
        if (currentData.parent) return currentData.parent;
        return '';
    }, [currentData.parent, currentData.parentFolder, currentData.parentFolderId, currentData.parentId]);
    const [parentId, setParentId] = React.useState(initialParentId);
    const nameInputRef = React.useRef();

    const folderTree = React.useMemo(() => buildFolderTree(context.state.folders), [context.state.folders]);
    const flatFolders = React.useMemo(() => flattenFolderTree(folderTree), [folderTree]);
    const descendantIds = React.useMemo(() => collectDescendantIds(context.state.folders, currentData.id), [context.state.folders, currentData.id]);

    React.useEffect(() => {
        if (currentData.create && currentData.parentId) {
            setParentId(currentData.parentId);
        }
    }, [currentData.create, currentData.parentId]);

    const closeModal = () => {
        context.dispatch({type: 'setModal'});
    };

    const close = () => {
        if (edited) {
            setDiscardConfirmOpen(true);
            return;
        }
        closeModal();
    };

    const confirmClose = () => {
        setDiscardConfirmOpen(false);
        closeModal();
    };

    const changeFolderName = e => {
        setName(e.target.value);
        setEdited(true);
    };

    const changeFolderStyles = (id, add) => {
        let folderStyles = styleIds.concat([]);
        if (add) {
            folderStyles.push(id);
        } else {
            folderStyles = folderStyles.filter(sid => (sid !== id));
        }
        setStyleIds(folderStyles);
        setEdited(true);
    };

    const saveFolder = e => {
        e.preventDefault();
        if (!name) {
            nativeAlert(locale.errorFolderCreation, locale.errorTitle, true);
            return false;
        }
        const parent = parentId || null;
        const data = {name, styleIds, parentId: parent};
        if (currentData.create) {
            data.id = Math.random().toString(36).substr(2, 8);
        } else {
            data.id = currentData.id;
        }
        context.dispatch({type: 'saveFolder', data});
        closeModal();
    };

    const deleteFolder = e => {
        e.preventDefault();
        if (!currentData.id) return;
        const permanent = deleteStyles || e.shiftKey;
        const confirmText = permanent
            ? (locale.confirmDeleteFolderPermanent || 'Are you sure you want to delete this folder AND all presets inside it?')
            : (locale.confirmDeleteFolderWithChildren || locale.confirmDeleteFolder || 'Are you sure you want to delete this folder?');
        nativeConfirm(confirmText, locale.confirmTitle, ok => {
            if (!ok) return;
            context.dispatch({type: 'deleteFolder', id: currentData.id, permanent});
            closeModal();
        });
    };

    React.useEffect(() => {
        if (nameInputRef.current) nameInputRef.current.focus();
    }, []);

    const parentOptions = flatFolders.filter(folder => {
        if (folder.id === currentData.id) return false;
        if (descendantIds.includes(folder.id)) return false;
        return true;
    });

    const styleGroups = React.useMemo(() => {
        const groups = [];
        const knownFolderIds = flatFolders.map(folder => folder.id);
        const unsortedStyles = context.state.styles.filter(s => !s.folder);

        if (unsortedStyles.length) {
            groups.push({
                id: '__unsorted__',
                label: locale.noFolderTitle,
                depth: 0,
                styles: unsortedStyles
            });
        }

        flatFolders.forEach(folder => {
            const styles = context.state.styles.filter(s => (s.folder === folder.id));
            if (!styles.length) return;
            groups.push({
                id: folder.id,
                label: folder.label,
                depth: folder.depth,
                styles
            });
        });

        context.state.folders
            .filter(folder => !knownFolderIds.includes(folder.id))
            .forEach(folder => {
                const styles = context.state.styles.filter(s => (s.folder === folder.id));
                if (!styles.length) return;
                groups.push({
                    id: folder.id,
                    label: folder.name,
                    depth: 0,
                    styles
                });
            });

        return groups;
    }, [context.state.folders, context.state.styles, flatFolders]);

    return (
        <React.Fragment>
            <div className="app-modal-header hostBrdBotContrast">
                <div className="app-modal-title">
                    {currentData.create ? locale.createFolderTitle : locale.editFolderTitle}
                </div>
                <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
                    <FiX size={18} />
                </button>
            </div>
            <div className="app-modal-body">
                <form className="app-modal-body-inner" onSubmit={saveFolder}>
                    {currentData.create && <FontScanPromo />}
                    <div className="fields">
                        <div className="field">
                            <div className="field-label">
                                {locale.editFolderNameLabel}
                            </div>
                            <div className="field-input">
                                <input 
                                    type="text" 
                                    ref={nameInputRef} 
                                    value={name} 
                                    onChange={changeFolderName} 
                                    className="topcoat-text-input--large"
                                />
                            </div>
                        </div>
                        <div className="field hostBrdTopContrast">
                            <div className="field-label">
                                {locale.editFolderParentLabel || 'Parent folder'}
                            </div>
                            <div className="field-input">
                                <select
                                    value={parentId || ''}
                                    onChange={e => { setParentId(e.target.value); setEdited(true); }}
                                    className="topcoat-textarea"
                                >
                                    <option value="">{locale.editFolderParentRoot || locale.noFolderTitle}</option>
                                    {parentOptions.map(folder => (
                                        <option key={folder.id} value={folder.id}>
                                            {"".padStart(folder.depth * 2, ' ')}{folder.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="field hostBrdTopContrast">
                            <div className="field-label">
                                {locale.editFolderStyles}
                            </div>
                            <div className="field-input">
                                <div className="folder-styles-list hostBrdContrast">
                                    {context.state.styles.length ? (
                                        <React.Fragment>
                                            {styleGroups.map(group => (
                                                <FolderStylesList
                                                    key={group.id}
                                                    label={group.label}
                                                    depth={group.depth}
                                                    styles={group.styles}
                                                    toggleStyle={changeFolderStyles}
                                                    selected={styleIds}
                                                />
                                            ))}
                                        </React.Fragment>
                                    ) : (
                                        <div className="folder-styles-list-empty">
                                            {locale.editFolderNoStyles}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        {!currentData.create && (
                            <div className="field hostBrdTopContrast" style={{ paddingTop: 10 }}>
                                <label className="topcoat-checkbox" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', opacity: 0.85, fontSize: 13, gap: 8 }}>
                                    <input
                                        type="checkbox"
                                        checked={deleteStyles}
                                        onChange={e => setDeleteStyles(e.target.checked)}
                                    />
                                    <div className="topcoat-checkbox__checkmark"></div>
                                    <span>{locale.deleteFolderStylesLabel || 'Delete all presets/styles inside this folder'}</span>
                                </label>
                            </div>
                        )}
                    </div>
                    <div className="fields folder-edit-actions hostBrdTopContrast">
                        <button type="submit" className={'folder-edit-save ' + (edited ? 'topcoat-button--large--cta' : 'topcoat-button--large')}>
                            <MdSave size={18} /> {locale.save}
                        </button>
                        {currentData.create ? (
                            <button type="button" className="topcoat-button--large--quiet" onClick={close}>
                                <MdCancel size={18} /> {locale.cancel}
                            </button>
                        ) : (
                            <button type="button" className="topcoat-button--large--quiet" onClick={deleteFolder}>
                                <MdDelete size={18} /> {locale.delete}
                            </button>
                        )}
                    </div>
                </form>
            </div>
            {discardConfirmOpen && (
                <UnsavedChangesDialog
                    onConfirm={confirmClose}
                    onCancel={() => setDiscardConfirmOpen(false)}
                />
            )}
        </React.Fragment>
    );
});


const FolderStylesList = React.memo(function FolderStylesList(props) {
    return (
        <div className="folder-style-group">
            <div className="folder-style-group-title hostBrdBotContrast" style={{ paddingLeft: props.depth ? props.depth * 10 + 6 : 6 }}>
                <span>{props.label}</span>
                <em>{props.styles.length}</em>
            </div>
            {props.styles.map(style => (
                <label key={style.id} className={'folder-style-item topcoat-checkbox hostBgdLight' + (props.selected.includes(style.id) ? ' m-selected' : '')} style={{ marginLeft: props.depth ? props.depth * 10 : 0 }}>
                    <div className="folder-style-cbx">
                        <input
                            type="checkbox"
                            checked={props.selected.includes(style.id)}
                            onChange={e => props.toggleStyle(style.id, e.target.checked)}
                        />
                        <div className="topcoat-checkbox__checkmark"></div>
                    </div>
                    <StylePreview style={style} />
                    <div className="folder-style-title">{style.name}</div>
                </label>
            ))}
        </div>
    );
});
FolderStylesList.propTypes = {
    label: PropTypes.string.isRequired,
    depth: PropTypes.number.isRequired,
    styles: PropTypes.array.isRequired,
    toggleStyle: PropTypes.func.isRequired,
    selected: PropTypes.array.isRequired
};

const StylePreview = React.memo(function StylePreview(props) {
    const textStyle = props.style.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
    const styleObject = getStyleObject(textStyle);
    const previewStyle = {
        ...styleObject,
        color: '#fff',
        fontFamily: styleObject.fontFamily || 'Tahoma'
    };
    if (props.style.stroke?.enabled && props.style.stroke?.size > 0) {
        const strokeColor = rgbToHex(props.style.stroke.color);
        previewStyle.textShadow = [
            `1px 0 ${strokeColor}`,
            `-1px 0 ${strokeColor}`,
            `0 1px ${strokeColor}`,
            `0 -1px ${strokeColor}`
        ].join(', ');
    }

    return (
        <div className="folder-style-preview" title={props.style.name}>
            <span style={previewStyle}>Aa</span>
        </div>
    );
});
StylePreview.propTypes = {
    style: PropTypes.object.isRequired
};

export default EditFolderModal;
