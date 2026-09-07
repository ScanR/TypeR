const fs = require('fs');
const path = require('path');
const app = path.resolve(__dirname, '../app');
fs.copyFileSync(path.resolve(__dirname, '../app_src/bootstrap.js'), path.join(app, 'index.js'));
fs.writeFileSync(path.join(app, 'index.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><title>TypeR</title></head><body><script src="index.js"></script></body></html>');
require('./writePackageInventory');
