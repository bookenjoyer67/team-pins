const sharp = require("sharp");
const path = require("path");

const src = path.join(__dirname, "..", "public", "globe.svg");
const out = path.join(__dirname, "..", "public");

async function main() {
  await sharp(src).resize(192, 192).png().toFile(path.join(out, "icon-192.png"));
  console.log("  ✓ icon-192.png");
  await sharp(src).resize(512, 512).png().toFile(path.join(out, "icon-512.png"));
  console.log("  ✓ icon-512.png");
}

main().catch((err) => {
  console.error("Icon generation failed:", err.message);
  process.exit(1);
});
