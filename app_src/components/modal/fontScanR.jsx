import { useModalClose } from "../../modalClose";
import './fontScanR.scss';

import React from 'react';
import PropTypes from 'prop-types';
import {FiX, FiFolderPlus, FiFolder, FiAlertTriangle, FiRefreshCw, FiCheckSquare, FiSquare} from 'react-icons/fi';
import {MdCancel, MdOutlineDocumentScanner, MdSave} from 'react-icons/md';

import {locale, nativeAlert, getStyleObject, rgbToHex, getUserFonts, scanPsdFonts} from '../../utils';
import {useContext} from '../../context';
import {buildFontGroups} from '../../fontScan';
import {buildFolderTree, flattenFolderTree} from '../../folderUtils';

const FontScanRModal = React.memo(function FontScanRModal() {
    const context = useContext((state) => ({
        folders: state.folders,
        openFolders: state.openFolders,
    }));
    const [step, setStep] = React.useState('pick');
    const [progress, setProgress] = React.useState({current: 0, total: 0, fileName: ''});
    const [groups, setGroups] = React.useState([]);
    const [scanStats, setScanStats] = React.useState({files: 0, layers: 0});
    const [scanErrors, setScanErrors] = React.useState([]);
    const [selectedKeys, setSelectedKeys] = React.useState([]);
    const [names, setNames] = React.useState({});
    const [destMode, setDestMode] = React.useState('new');
    const [newFolderName, setNewFolderName] = React.useState('');
    const [existingFolderId, setExistingFolderId] = React.useState('');
    const cancelledRef = React.useRef(false);
    const fileInputRef = React.useRef();

    const folderTree = React.useMemo(() => buildFolderTree(context.state.folders), [context.state.folders]);
    const flatFolders = React.useMemo(() => flattenFolderTree(folderTree), [folderTree]);
    const installedFonts = React.useMemo(() => {
        const set = new Set();
        getUserFonts().forEach(font => {
            if (font.postScriptName) set.add(font.postScriptName);
        });
        return set;
    }, []);

    React.useEffect(() => () => {
        cancelledRef.current = true;
    }, []);

    const close = () => {
        cancelledRef.current = true;
        context.dispatch({type: 'setModal'});
    };
  useModalClose(close);

    const pickFiles = () => {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
            fileInputRef.current.click();
        }
    };

    const finishScan = (results, errors) => {
        const fontGroups = buildFontGroups(results);
        const layers = results.reduce((sum, result) => sum + (result.layers ? result.layers.length : 0), 0);
        const defaultNames = {};
        fontGroups.forEach(group => {
            defaultNames[group.key] = group.defaultName;
        });
        setGroups(fontGroups);
        setScanStats({files: results.length, layers});
        setScanErrors(errors);
        setSelectedKeys(fontGroups.map(group => group.key));
        setNames(defaultNames);
        setStep('results');
    };

    const startScan = files => {
        if (!files.length) return;
        cancelledRef.current = false;
        setStep('scanning');
        setScanErrors([]);
        const results = [];
        const errors = [];
        const next = index => {
            if (cancelledRef.current) return;
            if (index >= files.length) {
                finishScan(results, errors);
                return;
            }
            setProgress({current: index + 1, total: files.length, fileName: files[index].name});
            scanPsdFonts(files[index].path, data => {
                if (cancelledRef.current) return;
                if (data && Array.isArray(data.layers)) results.push(data);
                else errors.push({file: files[index].name, error: (data && data.error) || 'unknown'});
                next(index + 1);
            });
        };
        next(0);
    };

    const onFilesPicked = e => {
        const files = Array.from(e.target.files || [])
            .filter(file => /\.psd$/i.test(file.name))
            .map(file => ({name: file.name, path: file.path || file.name}))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
        startScan(files);
    };

    const cancelScan = () => {
        cancelledRef.current = true;
        setStep('pick');
    };

    const toggleGroup = key => {
        setSelectedKeys(keys => (keys.includes(key) ? keys.filter(k => k !== key) : keys.concat(key)));
    };

    const toggleAll = () => {
        setSelectedKeys(keys => (keys.length === groups.length ? [] : groups.map(group => group.key)));
    };

    const renameGroup = (key, value) => {
        setNames(current => ({...current, [key]: value}));
    };

    const importStyles = e => {
        e.preventDefault();
        const selectedGroups = groups.filter(group => selectedKeys.includes(group.key));
        if (!selectedGroups.length) {
            nativeAlert(locale.fontScanErrorNoSelection, locale.errorTitle, true);
            return;
        }
        if (destMode === 'new' && !newFolderName.trim()) {
            nativeAlert(locale.errorFolderCreation, locale.errorTitle, true);
            return;
        }
        if (destMode === 'existing' && !existingFolderId) {
            nativeAlert(locale.fontScanErrorNoFolder, locale.errorTitle, true);
            return;
        }
        const styles = selectedGroups.map(group => ({
            name: (names[group.key] || group.defaultName).trim() || group.defaultName,
            textProps: group.textProps,
            stroke: group.stroke,
            prefixes: [],
            edited: Date.now()
        }));
        if (destMode === 'new') {
            context.dispatch({type: 'importStyleFolder', folder: {name: newFolderName.trim()}, styles});
        } else {
            styles.forEach(style => {
                context.dispatch({
                    type: 'saveStyle',
                    data: {...style, id: Math.random().toString(36).substr(2, 8), folder: existingFolderId}
                });
            });
            if (!context.state.openFolders.includes(existingFolderId)) {
                context.dispatch({type: 'toggleFolder', id: existingFolderId});
            }
        }
        close();
    };

    const allSelected = groups.length > 0 && selectedKeys.length === groups.length;
    const progressPercent = progress.total ? Math.round(((progress.current - 1) / progress.total) * 100) : 0;

    return (
        <React.Fragment>
            <div className="app-modal-header hostBrdBotContrast">
                <div className="app-modal-title fsr-title">
                    <MdOutlineDocumentScanner size={16} /> {locale.fontScanTitle}
                </div>
                <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
                    <FiX size={18} />
                </button>
            </div>
            <div className="app-modal-body">
                <div className="app-modal-body-inner fsr-body">
                    <input
                        type="file"
                        multiple
                        accept=".psd"
                        ref={fileInputRef}
                        style={{display: 'none'}}
                        onChange={onFilesPicked}
                    />
                    {step === 'pick' && (
                        <div className="fsr-pick">
                            <MdOutlineDocumentScanner size={42} className="fsr-pick-icon" />
                            <p className="fsr-pick-text">{locale.fontScanIntro}</p>
                            <button type="button" className="topcoat-button--large--cta fsr-pick-btn" onClick={pickFiles}>
                                {locale.fontScanPick}
                            </button>
                            <p className="fsr-pick-hint">{locale.fontScanPickHint}</p>
                        </div>
                    )}
                    {step === 'scanning' && (
                        <div className="fsr-scanning">
                            <MdOutlineDocumentScanner size={36} className="fsr-scanning-icon" />
                            <div className="fsr-scanning-file" title={progress.fileName}>{progress.fileName}</div>
                            <div className="fsr-progress hostBrdContrast">
                                <div className="fsr-progress-bar" style={{width: progressPercent + '%'}}></div>
                            </div>
                            <div className="fsr-scanning-count">
                                {locale.fontScanScanning.replace('{current}', progress.current).replace('{total}', progress.total)}
                            </div>
                            <button type="button" className="topcoat-button--large--quiet" onClick={cancelScan}>
                                <MdCancel size={16} /> {locale.cancel}
                            </button>
                        </div>
                    )}
                    {step === 'results' && (
                        <div className="fsr-results">
                            <div className="fsr-summary">
                                <span className="fsr-summary-chip hostBgd">{locale.fontScanFontsFound.replace('{count}', groups.length)}</span>
                                <span className="fsr-summary-chip hostBgd">{locale.fontScanLayersFound.replace('{count}', scanStats.layers)}</span>
                                <span className="fsr-summary-chip hostBgd">{locale.fontScanFilesFound.replace('{count}', scanStats.files)}</span>
                            </div>
                            {scanErrors.length > 0 && (
                                <div className="fsr-errors">
                                    <FiAlertTriangle size={14} />
                                    <span>{locale.fontScanScanFailed.replace('{files}', scanErrors.map(err => err.file).join(', '))}</span>
                                </div>
                            )}
                            {groups.length ? (
                                <React.Fragment>
                                    <div className="fsr-toolbar">
                                        <button type="button" className="topcoat-button--quiet fsr-toolbar-btn" onClick={toggleAll}>
                                            {allSelected ? <FiCheckSquare size={14} /> : <FiSquare size={14} />}
                                            {allSelected ? locale.fontScanDeselectAll : locale.fontScanSelectAll}
                                        </button>
                                        <span className="fsr-toolbar-count">{selectedKeys.length}/{groups.length}</span>
                                        <button type="button" className="topcoat-button--quiet fsr-toolbar-btn" onClick={pickFiles} title={locale.fontScanRescan}>
                                            <FiRefreshCw size={13} />
                                        </button>
                                    </div>
                                    <div className="fsr-list hostBrdContrast">
                                        {groups.map(group => (
                                            <FontGroupRow
                                                key={group.key}
                                                group={group}
                                                selected={selectedKeys.includes(group.key)}
                                                name={names[group.key] || ''}
                                                installed={installedFonts.has(group.fontPostScriptName)}
                                                onToggle={toggleGroup}
                                                onRename={renameGroup}
                                            />
                                        ))}
                                    </div>
                                    <div className="fsr-dest hostBrdTopContrast">
                                        <div className="fsr-dest-title">{locale.fontScanDestination}</div>
                                        <label className="fsr-dest-option topcoat-radio-button">
                                            <input
                                                type="radio"
                                                name="fsrDest"
                                                checked={destMode === 'new'}
                                                onChange={() => setDestMode('new')}
                                            />
                                            <div className="topcoat-radio-button__checkmark"></div>
                                            <FiFolderPlus size={14} />
                                            <span>{locale.fontScanNewFolder}</span>
                                        </label>
                                        {destMode === 'new' && (
                                            <input
                                                type="text"
                                                className="topcoat-text-input--large fsr-dest-input"
                                                placeholder={locale.fontScanFolderNamePlaceholder}
                                                value={newFolderName}
                                                onChange={e => setNewFolderName(e.target.value)}
                                            />
                                        )}
                                        <label className={'fsr-dest-option topcoat-radio-button' + (flatFolders.length ? '' : ' m-disabled')}>
                                            <input
                                                type="radio"
                                                name="fsrDest"
                                                disabled={!flatFolders.length}
                                                checked={destMode === 'existing'}
                                                onChange={() => setDestMode('existing')}
                                            />
                                            <div className="topcoat-radio-button__checkmark"></div>
                                            <FiFolder size={14} />
                                            <span>{locale.fontScanExistingFolder}</span>
                                        </label>
                                        {destMode === 'existing' && (
                                            <select
                                                className="topcoat-textarea fsr-dest-input"
                                                value={existingFolderId}
                                                onChange={e => setExistingFolderId(e.target.value)}
                                            >
                                                <option value="">—</option>
                                                {flatFolders.map(folder => (
                                                    <option key={folder.id} value={folder.id}>
                                                        {''.padStart(folder.depth * 2, ' ')}{folder.label}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                </React.Fragment>
                            ) : (
                                <div className="fsr-empty">
                                    <p>{locale.fontScanNoFonts}</p>
                                    <button type="button" className="topcoat-button--large" onClick={pickFiles}>
                                        <FiRefreshCw size={14} /> {locale.fontScanRescan}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {step === 'results' && groups.length > 0 && (
                <div className="app-modal-footer hostBrdTopContrast fsr-footer">
                    <button
                        type="button"
                        className={selectedKeys.length ? 'topcoat-button--large--cta fsr-footer-cta' : 'topcoat-button--large fsr-footer-cta'}
                        onClick={importStyles}
                    >
                        <MdSave size={16} /> {locale.fontScanImport.replace('{count}', selectedKeys.length)}
                    </button>
                    <button type="button" className="topcoat-button--large--quiet" onClick={close}>
                        <MdCancel size={16} /> {locale.cancel}
                    </button>
                </div>
            )}
        </React.Fragment>
    );
});

const FontGroupRow = React.memo(function FontGroupRow(props) {
    const group = props.group;
    const textStyle = group.textProps.layerText.textStyleRange[0].textStyle;
    const styleObject = getStyleObject(textStyle);
    const previewStyle = {
        ...styleObject,
        color: '#fff',
        fontFamily: styleObject.fontFamily || 'Tahoma'
    };
    if (group.stroke.enabled && group.stroke.size > 0) {
        const strokeColor = rgbToHex(group.stroke.color);
        previewStyle.textShadow = [
            `1px 0 ${strokeColor}`,
            `-1px 0 ${strokeColor}`,
            `0 1px ${strokeColor}`,
            `0 -1px ${strokeColor}`
        ].join(', ');
    }

    return (
        <div className={'fsr-item hostBgdLight' + (props.selected ? ' m-selected' : '')}>
            <label className="fsr-item-cbx topcoat-checkbox">
                <input type="checkbox" checked={props.selected} onChange={() => props.onToggle(group.key)} />
                <div className="topcoat-checkbox__checkmark"></div>
            </label>
            <div className="fsr-item-preview" onClick={() => props.onToggle(group.key)} title={group.fontPostScriptName}>
                <span style={previewStyle}>Aa</span>
            </div>
            <div className="fsr-item-main">
                <input
                    type="text"
                    className="topcoat-text-input fsr-item-name"
                    value={props.name}
                    onChange={e => props.onRename(group.key, e.target.value)}
                />
                <div className="fsr-item-meta">
                    <span className="fsr-chip">{group.topSize}px</span>
                    <span className="fsr-chip" title={locale.fontScanUsageHint}>×{group.usageCount}</span>
                    {group.stroke.enabled && group.stroke.size > 0 && (
                        <span className="fsr-chip fsr-chip-stroke" title={locale.fontScanStrokeHint}>
                            <i style={{background: rgbToHex(group.stroke.color)}}></i>
                            {group.stroke.size}px
                        </span>
                    )}
                    {!props.installed && (
                        <span className="fsr-chip fsr-chip-warn" title={locale.fontScanNotInstalledHint}>
                            <FiAlertTriangle size={10} /> {locale.fontScanNotInstalled}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});
FontGroupRow.propTypes = {
    group: PropTypes.object.isRequired,
    selected: PropTypes.bool.isRequired,
    name: PropTypes.string.isRequired,
    installed: PropTypes.bool.isRequired,
    onToggle: PropTypes.func.isRequired,
    onRename: PropTypes.func.isRequired
};

export default FontScanRModal;
