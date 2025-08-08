# TypeR

TypeR is an updated version of TyperTools, a Photoshop extension designed for typesetters working with manga and comics script. It simplifies routine tasks of typeset such as placing text on an image, aligning text, and performing style management. This version includes several bug fixes and new features to improve your workflow.

## Key Features

- **Bug Fixes**: Multiple bugs from the original TyperTools have been fixed.
- Added **stroke (outline)** support to styles.
- **Stable Auto-Centering**: Text shape no longer changes when using auto-centering.
- **Auto-centering** now works without manual selection by automatically detecting the bubble shape (like in Typesetterer).
- **Customizable Shortcuts**: You can now modify keyboard shortcuts. (+ added some new keyboard shortcuts)  
- **Automatic Page Detection**: Automatically detects pages when importing.  
- **Automatic Page Switching**: Automatically switches pages for seamless workflow.  
- **Resize TypeR**: Decreased size limit of the TypeR window so it can be much smaller.  
- **Line Spacing Sync**: When increasing/decreasing text size with TypeR, line spacing adjusts accordingly.  
- **Adaptive Size**: If no fixed text size is defined, the size of the selected layer will be used.  
- **Line Break on Insert**: A line break is now automatically added when inserting text on the current layer.  
- **Duplicate Style Folders**: You can now duplicate a style folder easily.  
- **Export a Single Folder**: No need to export all parameters and font styles, just export/import one (or more) folder as needed to share it your team members.
- **Tag priority**: Style with the same prefix matching is now prioritized based on the currently selected folder.



## Requirements

- Windows 8/macOS 10.9 or newer.
- Adobe Photoshop CC 2015 or newer.
  (There may be problems with some portable or lightweight builds)

## Installation Guide
# If you download from the release :
1. Download the [latest release](https://github.com/ScanR/TypeR/releases/latest/download/TypeR.zip)
2. Extract the archive and execute the installation script for your operating system.

   For macOS:
   ```sh
   chmod +x install_mac.sh
   ./install_mac.sh
   ```

   For Windows:
   ```sh
   install_win.cmd
   ```

# If you download from the source code :
### Prerequisites

- Ensure you have Node.js installed on your system. You can download it from [Node.js official website](https://nodejs.org/).

### Steps

1. Clone the repository and navigate to the root directory in your terminal.

   ```sh
   git clone https://github.com/ScanR/TypeR.git
   cd TypeR
   ```

2. Install the necessary dependencies.

   ```sh
   npm install
   ```

3. Build the project using npm. 


   ```sh
   npm run build
   ```

4. Execute the installation script for your operating system.

   For macOS:
   ```sh
   chmod +x install_mac.sh
   ./install_mac.sh
   ```

   For Windows:
   ```sh
   install_win.cmd
   ```
## Usage

After installation, you can access TypeR within Adobe Photoshop Extensions tab. 

## Contributing

If you encounter any issues or have suggestions for improvements, feel free to open an issue or submit a pull request.
