# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeR is an Adobe Photoshop extension designed for typesetters working with manga and comics. It's a React-based CEP (Common Extensibility Platform) extension that provides tools for text placement, alignment, and style management in Photoshop.

## Build Commands

don't build the extension because you can't really test it because it's on photoshop.

The build process:
1. Runs `clean.js` to clear the `app/` directory
2. Uses webpack to bundle React components from `app_src/` to `app/`
3. Runs `copyThemes.js` to copy theme files

## Architecture

### Core Structure
- **Entry point**: `app_src/index.jsx` - Main React app with context provider and hotkeys listener
- **Context management**: `app_src/context.jsx` - Global state using React Context and useReducer
- **Main layout**: `app_src/components/main/main.jsx` - Resizable three-panel layout (preview, text, styles)
- **CEP Integration**: `app_src/utils.js` - Photoshop communication via CSInterface
- **Host scripts**: `app_src/lib/jam/` - ExtendScript libraries for Photoshop automation

### Component Architecture
The app uses a three-block layout:
- **PreviewBlock**: Image preview and page navigation
- **TextBlock**: Text input and line management
- **StylesBlock**: Style folders and typography controls

### State Management
Uses React Context with a reducer pattern. Key state includes:
- `text` and `lines`: Current script content and processed lines
- `styles` and `folders`: Typography styles organized in folders
- `currentLineIndex`/`currentStyleId`: Active selections
- Theme, language, and user preferences

### CEP Extension Structure
- **Manifest**: `CSXS/manifest.xml` - Extension configuration
- **Host scripts**: `app/host.jsx` - ExtendScript code for Photoshop operations
- **Themes**: Multiple CSS themes in `themes/` and `app/themes/`

## Key Features
- Text prefix-based style matching system
- Folder-based style organization with priority
- Auto-centering text based on bubble detection
- Customizable keyboard shortcuts
- Multi-language support via `locale/` directory
- Automatic page detection and switching
- Export/import of style configurations

## Development Notes
- Uses Webpack 5 with Babel for React/JSX compilation
- SCSS for styling with PostCSS processing
- File assets embedded via base64-inline-loader for fonts
- CEP extension requires Adobe Photoshop CC 2015 or newer
- Extension communicates with Photoshop via CSInterface and ExtendScript
