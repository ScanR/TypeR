import './editFolder.scss';

import React from 'react';
import PropTypes from 'prop-types';
import {FiX} from "react-icons/fi";
import {MdDelete, MdCancel, MdSave} from "react-icons/md";

import {locale, nativeAlert, nativeConfirm} from '../../utils';
import {useContext} from '../../context';

const buildFolderTree = (folders) => {
    const map = new Map();
    (folders || []).forEach(folder => {
        map.set(folder.id, { ...folder, children: [] });
    });
    const roots = [];
    map.forEach(folder => {
        if (folder.parentId && map.has(folder.parentId)) {
            map.get(folder.parentId).children.push(folder);
        } else {
            roots.push(folder);
        }
    });
    const sortRecursive = (nodes) => {
        nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        nodes.forEach(node => sortRecursive(node.children));
    };
    sortRecursive(roots);
    return roots;
};

const flattenFolderTree = (nodes, parents = [], depth = 0) => {
    const list = [];
    nodes.forEach(node => {
        const breadcrumb = parents.concat(node.name);
        list.push({
            id: node.id,
            name: node.name,
            parentId: node.parentId || null,
            depth,
            label: breadcrumb.join(' / '),
            children: node.children || []
        });
        list.push(...flattenFolderTree(node.children || [], breadcrumb, depth + 1));
    });
    return list;
};

const collectDescendantIds = (folders, folderId) => {
    if (!folderId) return [];
    const ids = [];
    const queue = [folderId];
    while (queue.length) {
        const current = queue.shift();
        const children = folders.filter(folder => (folder.parentId || null) === current);
        children.forEach(child => {
            ids.push(child.id);
            queue.push(child.id);
        });
    }
    return ids;
};

const EditFolderModal = React.memo(function EditFolderModal() {
    const context = useContext();
    const currentData = context.state.modalData;
    const folderStyleIds = currentData.id ? context.state.styles.filter(s => (s.folder === currentData.id)).map(s => s.id) : [];
    const [name, setName] = React.useState(currentData.name || '');
    const [styleIds, setStyleIds] = React.useState(folderStyleIds);
    const [edited, setEdited] = React.useState(false);
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

    const close = () => {
        context.dispatch({type: 'setModal'});
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
        close();
    };

    const deleteFolder = e => {
        e.preventDefault();
        if (!currentData.id) return;
        const permanent = e.shiftKey;
        const confirmText = permanent ? locale.confirmDeleteFolderPermanent : (locale.confirmDeleteFolderWithChildren || locale.confirmDeleteFolder);
        nativeConfirm(confirmText, locale.confirmTitle, ok => {
            if (!ok) return;
            context.dispatch({type: 'deleteFolder', id: currentData.id, permanent});
            close();
        });
    };

    React.useEffect(() => {
        if (nameInputRef.current) nameInputRef.current.focus();
    }, []);

    const unsortedStyles = context.state.styles.filter(s => !s.folder);

    const parentOptions = flatFolders.filter(folder => {
        if (folder.id === currentData.id) return false;
        if (descendantIds.includes(folder.id)) return false;
        return true;
    });

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
                                            {(unsortedStyles.length > 0) && (
                                                <FolderStylesList 
                                                    label={locale.noFolderTitle}
                                                    styles={unsortedStyles}
                                                    toggleStyle={changeFolderStyles}
                                                    selected={styleIds}
                                                />
                                            )}
                                            {flatFolders.map(folder => (
                                                <FolderStylesList 
                                                    key={folder.id}
                                                    label={folder.label}
                                                    styles={context.state.styles.filter(s => (s.folder === folder.id))}
                                                    toggleStyle={changeFolderStyles}
                                                    selected={styleIds}
                                                />
                                            ))}
                                            {context.state.folders.filter(folder => !flatFolders.find(f => f.id === folder.id)).map(folder => (
                                                <FolderStylesList 
                                                    key={folder.id} 
                                                    label={folder.name}
                                                    styles={context.state.styles.filter(s => (s.folder === folder.id))}
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
        </React.Fragment>
    );
});


const FolderStylesList = React.memo(function FolderStylesList(props) {
    return (
        <React.Fragment>
            {props.styles.map(style => (
                <label key={style.id} className={'folder-style-item topcoat-checkbox hostBgdLight' + (props.selected.includes(style.id) ? ' m-selected' : '')}>
                    <div className="folder-style-cbx">
                        <input 
                            type="checkbox" 
                            checked={props.selected.includes(style.id)}
                            onChange={e => props.toggleStyle(style.id, e.target.checked)}
                        />
                        <div className="topcoat-checkbox__checkmark"></div>
                    </div>
                    <div className="folder-style-title">{style.name} <span>({props.label})</span></div>
                </label>
            ))}
        </React.Fragment>
    );
});
FolderStylesList.propTypes = {
    label: PropTypes.string.isRequired,
    styles: PropTypes.array.isRequired,
    toggleStyle: PropTypes.func.isRequired,
    selected: PropTypes.array.isRequired
};

export default EditFolderModal;
