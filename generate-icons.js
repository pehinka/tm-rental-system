// generate-icons.js — Vygeneruje ikony pro PWA
// Spusť: node generate-icons.js

const fs = require("fs");
const path = require("path");

// Jednoduchá SVG ikona jako PNG placeholder
function createSVGIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#00e5a0"/>
      <stop offset="100%" style="stop-color:#00b4d8"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="url(#bg)"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" 
        fill="#0a0a0f" font-family="Arial,sans-serif" font-weight="800" 
        font-size="${size * 0.35}">TM</text>
</svg>`;
}

// Ulož jako SVG (prohlížeče to zvládnou i jako "png" source v manifestu)
const sizes = [192, 512];
for (const size of sizes) {
  const svg = createSVGIcon(size);
  const filePath = path.join(__dirname, "public", `icon-${size}.svg`);
  fs.writeFileSync(filePath, svg);
  console.log(`✅ Vytvořena ikona: icon-${size}.svg`);
}

// Aktualizuj manifest aby ukazoval na SVG
const manifestPath = path.join(__dirname, "public", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.icons = sizes.map((s) => ({
  src: `/icon-${s}.svg`,
  sizes: `${s}x${s}`,
  type: "image/svg+xml",
}));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log("✅ Manifest aktualizován");
