// Basic syntax check
const acorn = require('acorn');
const fs = require('fs');
try {
  acorn.parse(fs.readFileSync('extension/content.js', 'utf8'), { ecmaVersion: 2022 });
  console.log("Syntax OK");
} catch (e) {
  console.error("Syntax Error:", e);
}
