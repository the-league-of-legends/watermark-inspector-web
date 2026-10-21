// 私有媒体回归入口。测试文件路径仅由调用者提供，不进入 Web 产物。
const fs = require('node:fs');
const codec = require('../src/codec.js');
const [file, width, height] = process.argv.slice(2);
console.log(JSON.stringify(codec.decodeImage(fs.readFileSync(file), Number(width), Number(height))));
