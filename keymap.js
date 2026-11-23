// Maps a keyboard event to the name the game uses. Pure, so tests can load it without a browser.
// The four movement keys follow their physical position (KeyW/A/S/D), so AZERTY players get ZQSD and Dvorak players keep the same hand shape.
// Everything else uses the typed character. The letter printed on the key also works, so on AZERTY both Z (the W position) and W drive forward.
const MOVE_CODES = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };

export const keyName = (e) => MOVE_CODES[e.code] || (e.key.length === 1 ? e.key.toLowerCase() : e.key);
