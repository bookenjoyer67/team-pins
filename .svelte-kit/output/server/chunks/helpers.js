import "./dialogs.js";
//#region helpers.js
var COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#16a34a",
	"#2563eb",
	"#7c3aed",
	"#ec4899",
	"#6b7280"
];
function validateHex(hex) {
	let h = hex.trim();
	if (h.startsWith("#")) h = h.slice(1);
	if (/^[0-9a-fA-F]{6}$/.test(h)) return "#" + h.toLowerCase();
	return null;
}
function addHuePicker(element, getColor, setColor) {
	return (e) => {
		e.stopPropagation();
		const picker = document.createElement("input");
		picker.type = "color";
		picker.value = getColor();
		picker.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
		if (document.body.classList.contains("dark")) picker.style.colorScheme = "dark";
		document.body.appendChild(picker);
		picker.oninput = () => setColor(picker.value);
		picker.onblur = () => picker.remove();
		picker.click();
	};
}
function colorPresetsHTML(colors, selectedColor) {
	return colors.map((c) => `<span class="color-preset" data-color="${c}" style="display:inline-block;width:22px;height:22px;background:${c};border-radius:50%;cursor:pointer;border:2px solid ${c === selectedColor ? "#111" : "transparent"};margin:2px;"></span>`).join("");
}
function hueDotHTML(selectedColor, id) {
	return `<span class="color-preset" id="${id}" style="display:inline-block;width:22px;height:22px;border-radius:50%;cursor:pointer;border:2px solid ${COLORS.includes(selectedColor) ? "transparent" : "#111"};margin:2px;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);background-size:140% 140%;background-position:center;"></span>`;
}
function hexInputHTML(id, value) {
	return `<input type="text" id="${id}" value="${value}" placeholder="#hex" style="width:62px;height:22px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:11px;padding:0 4px;box-sizing:border-box;font-family:monospace;margin:2px;" />`;
}
function wireColorPicker(pickerId, colorInputId, hexInputId, colors) {
	const picker = document.getElementById(pickerId);
	const colorInput = document.getElementById(colorInputId);
	const hexInput = document.getElementById(hexInputId);
	const setColor = (color) => {
		colorInput.value = color;
		picker.querySelectorAll(".color-preset").forEach((s) => {
			const dc = s.dataset.color;
			if (dc) s.style.border = dc === color ? "2px solid #111" : "2px solid transparent";
			else s.style.border = COLORS.includes(color) ? "2px solid transparent" : "2px solid #111";
		});
		if (hexInput && document.activeElement !== hexInput) hexInput.value = color;
	};
	picker.querySelectorAll(".color-preset").forEach((c) => {
		c.onclick = () => {
			if (c.dataset.color) setColor(c.dataset.color);
			else {
				const getColor = () => colorInput.value;
				addHuePicker(null, getColor, setColor)({ stopPropagation: () => {} });
			}
		};
	});
	if (hexInput) {
		hexInput.oninput = () => {
			const hex = validateHex(hexInput.value);
			if (hex) setColor(hex);
		};
		hexInput.onblur = () => {
			hexInput.value = colorInput.value;
		};
	}
	return setColor;
}
//#endregion
export { validateHex as a, hueDotHTML as i, colorPresetsHTML as n, wireColorPicker as o, hexInputHTML as r, COLORS as t };
