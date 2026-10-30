const fs = require('fs');
const path = require('path');
const app = path.resolve(__dirname, '../app');
fs.copyFileSync(path.resolve(__dirname, '../app_src/bootstrap.js'), path.join(app, 'index.js'));
// Practice pages of the guided tours, opened in Photoshop
fs.mkdirSync(path.join(app, 'assets'), { recursive: true });
fs.copyFileSync(path.resolve(__dirname, '../app_src/assets/typer-practice-page.png'), path.join(app, 'assets/typer-practice-page.png'));
fs.copyFileSync(path.resolve(__dirname, '../app_src/assets/typer-basics-page.png'), path.join(app, 'assets/typer-basics-page.png'));
fs.writeFileSync(path.join(app, 'index.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><title>TypeR</title></head><body><script src="index.js"></script></body></html>');
require('./writePackageInventory');
