import './help.scss';

import { fetchBody } from "../../network";
import React from 'react';
import {
    FiAlignLeft,
    FiBookOpen,
    FiCommand,
    FiCopy,
    FiCrosshair,
    FiEye,
    FiHelpCircle,
    FiLayers,
    FiMessageCircle,
    FiPlayCircle,
    FiSave,
    FiSearch,
    FiVideo,
    FiX,
} from 'react-icons/fi';

import config from '../../config';
import {locale, openUrl, readStorage, writeToStorage} from '../../utils';
import {useContext} from '../../context';
import {shortcutCommands} from '../../shortcutCommands';

const VIDEO_URL = 'https://typer.hayasaku.fr/video-guide/';
const VIDEO_CONFIG_URL = 'https://typer.hayasaku.fr/video-guide/config.json';
const VIDEO_GUIDE_CURRENT_SEEN_KEY = 'videoGuideCurrentSeen';
const MULTI_BUBBLE_VIDEO_URL = 'https://youtu.be/gmIh-eEj2HY';

// Pretty names for the raw key tokens stored in the shortcut settings
const KEY_LABELS = {
    WIN: /mac/i.test(window.navigator.platform) ? '⌘' : 'Win',
    CTRL: 'Ctrl',
    ALT: /mac/i.test(window.navigator.platform) ? '⌥' : 'Alt',
    SHIFT: 'Shift',
    ENTER: '↵',
    TAB: 'Tab',
    SPACE: 'Space',
    PLUS: '+',
    MINUS: '−',
    EQUAL: '=',
    DIVIDE: '/',
    MULTIPLY: '*',
    MOUSE4: 'Mouse 4',
    MOUSE5: 'Mouse 5',
};

const keyLabel = (key) => KEY_LABELS[key] || key;

// Illustrations are optional: drop <name>.gif in icons/help/ and it shows up
const HelpMedia = React.memo(function HelpMedia({name, caption}) {
    const [failed, setFailed] = React.useState(false);
    if (failed) return null;
    return (
        <figure className="help-media">
            <img src={`../icons/help/${name}.gif`} alt={caption || name} onError={() => setFailed(true)} />
            {caption ? <figcaption>{caption}</figcaption> : null}
        </figure>
    );
});

const KeyCombo = React.memo(function KeyCombo({keys}) {
    if (!Array.isArray(keys) || !keys.length) {
        return <span className="help-keys-empty">{locale.helpNoShortcut || 'not set'}</span>;
    }
    return (
        <span className="help-keys">
            {keys.map((key, index) => (
                <React.Fragment key={`${key}-${index}`}>
                    {index > 0 ? <i>+</i> : null}
                    <kbd>{keyLabel(key)}</kbd>
                </React.Fragment>
            ))}
        </span>
    );
});

const HelpModal = React.memo(function HelpModal() {
    const context = useContext((state) => ({ shortcut: state.shortcut }));
    const [query, setQuery] = React.useState('');
    const [openId, setOpenId] = React.useState('styles');
    const [videoIsLegacy, setVideoIsLegacy] = React.useState(false);
    const shortcut = context.state.shortcut || {};

    React.useEffect(() => {
        if (readStorage(VIDEO_GUIDE_CURRENT_SEEN_KEY) === true) return undefined;

        let active = true;
        fetchBody(`${VIDEO_CONFIG_URL}?v=${Date.now()}`, {cache: 'no-store'})
            .then((remoteConfig) => {
                if (active && typeof remoteConfig.isLegacy === 'boolean') {
                    setVideoIsLegacy(remoteConfig.isLegacy);
                    if (!remoteConfig.isLegacy) {
                        writeToStorage({[VIDEO_GUIDE_CURRENT_SEEN_KEY]: true});
                    }
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    const close = () => context.dispatch({type: 'setModal'});
    const openWalkthrough = () => context.dispatch({type: 'setModal', modal: 'walkthrough', data: {source: 'help'}});

    const steps = [
        {
            title: locale.helpStepScriptTitle || 'Paste the script',
            text: locale.helpStepScriptText || 'The text is split into lines. The active line is highlighted.',
        },
        {
            title: locale.helpStepStyleTitle || 'Pick a style',
            text: locale.helpStepStyleText || 'Tags such as SFX: select the matching style on their own.',
        },
        {
            title: locale.helpStepSelectTitle || 'Select the bubble',
            text: locale.helpStepSelectText || 'Any selection tool works, only the outer bounds matter.',
        },
        {
            title: locale.helpStepPasteTitle || 'Paste',
            text: locale.helpStepPasteText || 'The layer is created, centered, and the next line becomes active.',
        },
    ];

    const shortcutDetails = {
        add: locale.helpQuickPasteDescr,
        apply: locale.helpQuickApplyDescr,
        keepTextSize: locale.shortcut_keepTextSizeDescr,
        center: locale.helpQuickAlignDescr,
        insertText: locale.helpShortcutInsertTextDescr || 'Pastes the line text only, keeping the layer style.',
        previous: locale.helpShortcutPreviousDescr || 'Moves to the previous non-ignored line.',
        next: locale.helpShortcutNextDescr || 'Moves to the next non-ignored line.',
        increase: locale.helpShortcutIncreaseDescr || 'Increases the size of the active text layer.',
        decrease: locale.helpShortcutDecreaseDescr || 'Decreases the size of the active text layer.',
        nextPage: locale.helpQuickNextPageDescr,
        toggleMultiBubble: locale.helpQuickMultiBubbleDescr,
    };
    const shortcutRows = shortcutCommands.map((command) => ({
        id: command.id,
        detail: shortcutDetails[command.id] || '',
    }));

    const sections = [
        {
            id: 'styles',
            icon: FiLayers,
            title: locale.helpSectionStylesTitle || 'Styles and folders',
            subtitle: locale.helpSectionStylesSubtitle || 'Build your typesetting toolbox once, reuse it everywhere.',
            media: 'styles',
            mediaCaption: locale.helpSectionStylesMedia || 'Creating a style from an existing text layer',
            items: [
                {
                    title: locale.helpStylesCreateTitle || 'Create a style',
                    text: locale.helpStylesCreateText || 'Add a style, then either copy the settings from a selected text layer or fill the form manually.',
                },
                {
                    title: locale.helpStylesTagsTitle || 'Style tags',
                    text: locale.helpStylesTagsText || 'Tags such as "SFX:" (separated by spaces) select the style automatically when a line starts with them, and are removed from the pasted layer.',
                },
                {
                    title: locale.helpStylesColorTitle || 'Tag colour',
                    text: locale.helpStylesColorText || 'Each style can have its own tag colour, highlighted directly in the script.',
                },
                {
                    title: locale.helpStylesFoldersTitle || 'Folders',
                    text: locale.helpStylesFoldersText || 'Group styles into folders, reorder them by dragging. Deleting a folder moves its styles to "Unsorted".',
                },
                {
                    title: locale.helpStylesApplyTitle || 'Apply to a layer',
                    text: locale.helpStylesApplyText || 'The arrow next to a style applies it to the active text layer without touching its content.',
                },
            ],
        },
        {
            id: 'script',
            icon: FiAlignLeft,
            title: locale.helpSectionScriptTitle || 'Script and lines',
            subtitle: locale.helpSectionScriptSubtitle || 'Navigate the translation without leaving Photoshop.',
            media: 'script',
            mediaCaption: locale.helpSectionScriptMedia || 'Navigating lines and pages',
            items: [
                {
                    title: locale.helpScriptSplitTitle || 'Automatic splitting',
                    text: locale.helpScriptSplitText || 'Typed or pasted text is split line by line. The active line is highlighted and shown in the preview.',
                },
                {
                    title: locale.helpScriptNavTitle || 'Navigation',
                    text: locale.helpScriptNavText || 'Click the marker on the left of a line to activate it, or use the previous/next buttons near the preview.',
                },
                {
                    title: locale.helpScriptIgnoreTitle || 'Ignored lines',
                    text: locale.helpScriptIgnoreText || 'Empty lines are skipped. Ignore tags let you skip page numbers or translator notes as well.',
                },
                {
                    title: locale.helpScriptPagesTitle || 'Page markers',
                    text: locale.helpScriptPagesText || 'Lines starting with a page marker are used to jump from page to page, and to switch the open PSD automatically.',
                    keys: shortcut.nextPage,
                },
                {
                    title: locale.helpScriptMarkdownTitle || 'Markdown',
                    text: locale.helpQuickMarkdownDescr || 'Enable markdown to keep bold and italic markers when pasting formatted text.',
                },
            ],
        },
        {
            id: 'preview',
            icon: FiEye,
            title: locale.helpSectionPreviewTitle || 'Preview and size',
            subtitle: locale.helpSectionPreviewSubtitle || 'See the result before it touches the page.',
            media: 'preview',
            mediaCaption: locale.helpSectionPreviewMedia || 'Adjusting the scale on a small scan',
            items: [
                {
                    title: locale.helpPreviewWhatTitle || 'What it shows',
                    text: locale.helpPreviewWhatText || 'The active line rendered with the active style, along with the line number, style name and font scaling.',
                },
                {
                    title: locale.helpPreviewScaleTitle || 'Scaling',
                    text: locale.helpPreviewScaleText || 'Scaling resizes every pasted text without changing the styles. On small scans, 50% pastes text half the size defined in the style.',
                },
                {
                    title: locale.helpPreviewSizeTitle || 'One-off size',
                    text: locale.helpPreviewSizeText || 'A size typed manually stays in use until you select another style.',
                    keys: shortcut.increase,
                },
            ],
        },
        {
            id: 'paste',
            icon: FiCrosshair,
            title: locale.helpSectionPasteTitle || 'Paste and align',
            subtitle: locale.helpSectionPasteSubtitle || 'The core loop: select, paste, move on.',
            media: 'paste',
            mediaCaption: locale.helpSectionPasteMedia || 'Pasting a line into a bubble',
            items: [
                {
                    title: locale.helpPasteSelectionTitle || 'The selection',
                    text: locale.helpPasteSelectionText || 'Marquee, lasso, magic wand: any shape works, only its four outer bounds are used.',
                },
                {
                    title: locale.helpPastePasteTitle || 'Paste',
                    text: locale.helpQuickPasteDescr || 'Creates a styled text layer in the current selection and advances to the next line.',
                    keys: shortcut.add,
                },
                {
                    title: locale.helpPasteAlignTitle || 'Align',
                    text: locale.helpQuickAlignDescr || 'Centers the active text layer in the current selection.',
                    keys: shortcut.center,
                },
                {
                    title: locale.helpPasteApplyTitle || 'Apply',
                    text: locale.helpQuickApplyDescr || 'Replaces the active text layer content and style with the current line and style.',
                    keys: shortcut.apply,
                },
            ],
        },
        {
            id: 'multibubble',
            icon: FiCopy,
            title: locale.helpSectionMultiTitle || 'Multi-bubble',
            subtitle: locale.helpSectionMultiSubtitle || 'Fill a whole panel in one shot.',
            media: 'multibubble',
            mediaCaption: locale.helpSectionMultiMedia || 'Capturing several bubbles then pasting them',
            link: {url: MULTI_BUBBLE_VIDEO_URL, label: locale.multiBubbleModeHowToUse || 'How to use'},
            items: [
                {
                    title: locale.helpMultiEnableTitle || 'Turn it on',
                    text: locale.helpQuickMultiBubbleDescr || 'Captures several selections, then inserts several text lines in one action.',
                    keys: shortcut.toggleMultiBubble,
                },
                {
                    title: locale.helpMultiCaptureTitle || 'Capture the bubbles',
                    text: locale.multiBubbleShiftTip || 'Multi-bubble works with one selection at a time. Release Shift and create selections one by one.',
                },
                {
                    title: locale.helpMultiClearTitle || 'Clear the queue',
                    text: locale.multiBubbleClearAllTip || 'Tip: Hold the - button for 1 second to clear all selections at once',
                },
            ],
        },
        {
            id: 'data',
            icon: FiSave,
            title: locale.helpSectionDataTitle || 'Backup and sharing',
            subtitle: locale.helpSectionDataSubtitle || 'Keep your setup safe, or hand it to your team.',
            items: [
                {
                    title: locale.helpDataExportTitle || 'Export',
                    text: locale.helpDataExportText || 'Save styles, folders and settings to a JSON file, choosing exactly what goes in it.',
                },
                {
                    title: locale.helpDataImportTitle || 'Import',
                    text: locale.helpDataImportText || 'Load a JSON file to restore your setup after reinstalling Photoshop, or to share it with other typesetters.',
                },
                {
                    title: locale.helpDataFontScanTitle || 'Font scan',
                    text: locale.helpDataFontScanText || 'Scan a PSD to list the fonts it uses before starting a chapter.',
                },
            ],
        },
        {
            id: 'shortcuts',
            icon: FiCommand,
            title: locale.helpSectionShortcutsTitle || 'Shortcuts',
            subtitle: locale.helpSectionShortcutsSubtitle || 'Your current bindings, editable in Settings.',
            shortcuts: shortcutRows.map((row) => ({
                title: locale[`shortcut_${row.id}`] || row.id,
                text: row.detail || '',
                keys: shortcut[row.id],
            })),
        },
    ];

    const search = query.trim().toLowerCase();
    const matches = (value) => !!value && String(value).toLowerCase().indexOf(search) !== -1;

    const visibleSections = React.useMemo(() => {
        if (!search) return sections;
        return sections
            .map((section) => {
                const sectionMatch = matches(section.title) || matches(section.subtitle);
                const filterRows = (rows) => (rows || []).filter((row) => matches(row.title) || matches(row.text));
                const items = sectionMatch ? section.items : filterRows(section.items);
                const shortcuts = sectionMatch ? section.shortcuts : filterRows(section.shortcuts);
                if (!sectionMatch && !(items || []).length && !(shortcuts || []).length) return null;
                return {...section, items, shortcuts};
            })
            .filter(Boolean);
    }, [search, context.state.shortcut]);

    const renderRow = (row, index) => (
        <li key={`${row.title}-${index}`} className="help-item">
            <div className="help-item-head">
                <span className="help-item-title">{row.title}</span>
                {row.keys ? <KeyCombo keys={row.keys} /> : null}
            </div>
            {row.text ? <p className="help-item-text">{row.text}</p> : null}
        </li>
    );

    return (
        <React.Fragment>
            <div className="app-modal-header hostBrdBotContrast">
                <div className="app-modal-title help-title">
                    <FiHelpCircle size={16} /> {locale.helpTitle}
                </div>
                <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
                    <FiX size={18} />
                </button>
            </div>
            <div className="app-modal-body">
                <div className="app-modal-body-inner help">
                    <div className="help-intro">{locale.helpIntro || 'TypeR places, styles and aligns your text for you: keep the script in the panel and let Photoshop do the rest.'}</div>

                    <div className="help-steps">
                        {steps.map((step, index) => (
                            <div className="help-step" key={step.title}>
                                <span className="help-step-num">{index + 1}</span>
                                <div className="help-step-body">
                                    <b>{step.title}</b>
                                    <span>{step.text}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="help-actions">
                        <button type="button" className="topcoat-button--large--cta help-action" onClick={openWalkthrough}>
                            <FiPlayCircle size={15} /> {locale.helpOpenWalkthrough || 'Interactive walkthrough'}
                        </button>
                        <button type="button" className="topcoat-button--large help-action" onClick={() => openUrl(VIDEO_URL)}>
                            <FiVideo size={15} /> {videoIsLegacy
                                ? (locale.helpVideoGuide || 'Old video guide')
                                : (locale.helpVideoGuideCurrent || 'Video guide')}
                            {!videoIsLegacy
                                ? <b className="settings-new-badge help-video-badge">{locale.settingsNewBadge || 'New'}</b>
                                : null}
                        </button>
                        <button type="button" className="topcoat-button--large help-action" onClick={() => openUrl(config.authorUrl)}>
                            <FiMessageCircle size={15} /> {locale.helpSupport || 'Support'}
                        </button>
                    </div>

                    <div className="help-search">
                        <FiSearch size={14} />
                        <input
                            type="text"
                            className="topcoat-textarea"
                            value={query}
                            placeholder={locale.helpSearchPlaceholder || 'Search help...'}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query ? (
                            <button type="button" className="topcoat-icon-button--quiet" title={locale.close} onClick={() => setQuery('')}>
                                <FiX size={14} />
                            </button>
                        ) : null}
                    </div>

                    {visibleSections.length ? (
                        <div className="help-sections">
                            {visibleSections.map((section) => {
                                const Icon = section.icon;
                                const expanded = !!search || openId === section.id;
                                return (
                                    <div className={`help-section${expanded ? ' m-open' : ''}`} key={section.id}>
                                        <button
                                            type="button"
                                            className="help-section-head"
                                            aria-expanded={expanded}
                                            onClick={() => setOpenId(openId === section.id ? null : section.id)}
                                        >
                                            <span className="help-section-icon"><Icon size={15} /></span>
                                            <span className="help-section-titles">
                                                <b>{section.title}</b>
                                                <span>{section.subtitle}</span>
                                            </span>
                                            <span className="help-section-chevron">{expanded ? '−' : '+'}</span>
                                        </button>
                                        {expanded ? (
                                            <div className="help-section-body">
                                                {section.media ? <HelpMedia name={section.media} caption={section.mediaCaption} /> : null}
                                                {(section.items || []).length ? <ul className="help-items">{section.items.map(renderRow)}</ul> : null}
                                                {(section.shortcuts || []).length ? <ul className="help-items">{section.shortcuts.map(renderRow)}</ul> : null}
                                                {section.link ? (
                                                    <button type="button" className="help-inline-link" onClick={() => openUrl(section.link.url)}>
                                                        <FiVideo size={13} /> {section.link.label}
                                                    </button>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="help-empty">
                            <FiBookOpen size={20} />
                            <span>{locale.helpNoResult || 'Nothing matches this search.'}</span>
                        </div>
                    )}
                </div>
            </div>
            <div className="app-modal-footer hostBrdTopContrast help-footer">
                <div>
                    <span className="link" onClick={() => openUrl(config.appUrl)}><b>{config.appTitle}</b></span> ({locale.helpVersion}: {config.appVersion}) — {locale.helpAuthor || 'developed by'} <span className="link" onClick={() => openUrl(config.authorUrl)}>{config.authorName}</span>
                </div>
                <div>
                    <span className="link" onClick={() => openUrl(config.typerToolsUrl)}>typertools</span>, developped by Swirt
                </div>
            </div>
        </React.Fragment>
    );
});

export default HelpModal;
