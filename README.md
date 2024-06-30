# TypeR

TypeR is an enhanced fork of TyperTools, a Photoshop extension designed for typesetters working with manga and comics script. It simplifies routine tasks of typeset such as placing text on an image, aligning text, and performing style management. This version includes several bug fixes and new features to improve your workflow.

## Key Features

- **Bug Fixes**: Multiple bugs from the original TyperTools have been fixed.
- **Text Smoothing Issue Resolved**: Fixed the bug that changed text smoothing from "Strong" to "Smooth" when increasing text size.
- **Stable Auto-Centering**: Text shape no longer changes when using auto-centering.
- **Customizable Shortcuts**: You can now modify keyboards shortcuts. (+ added some new keyboard shortcuts)
- **Automatic Page Detection**: Automatically detects pages when importing.
- **Automatic Page Switching**: Automatically switches pages for seamless workflow.
- **Resize TypeR**: Decreased size limit of the TypeR window so it can be way smaller.
- **Line Spacing**: When you increase/decrease the size of the text with TypeR, the line spacing also increase/decrease along.
- **Adaptative size**: When you don't define a fixed size of text style, it will take the size of the current selected layer.
- **Export a single folder**: You don't need to export all your parameters and font style anymore, you can just export/import one folder!


## Requirements

- Windows 8/macOS 10.9 or newer.
- Adobe Photoshop CC 2015 or newer.
  (There may be problems with some portable or lightweight builds)

## Installation Guide
# If you download from the source code :
### Prerequisites

- Ensure you have Node.js installed on your system. You can download it from [Node.js official website](https://nodejs.org/).

### Steps

1. Clone the repository and navigate to the root directory in your terminal.

   ```sh
   git clone https://github.com/SeanR-ScanR/TypeR.git
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

# If you download from the release :
1. Extract the archive and execute the installation script for your operating system.

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
