const path = require('node:path');
const fs = require('node:fs');
const directory = path.resolve(__dirname, '../../../work');
fs.mkdirSync(directory, { recursive: true });
module.exports = directory;
