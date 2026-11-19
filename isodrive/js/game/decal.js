// Decals: small pixel pictures painted on the roof of a vehicle (16x16) or trailer (32x16, wider for longer bodies).
// Stored as a string, one hex digit per pixel (0 = transparent, 1-f = PAL colour). 256 / 512 chars, so saves stay tiny.
export const PAL = [null, '#000000', '#ffffff', '#e8453c', '#f28c28', '#f5d742', '#4fc860', '#2fb7d4', '#4a6cf0', '#a85cf0', '#f060b0', '#7a4a2a', '#8a8a94', '#33333a', '#00ffff', '#ffd9b0'];
export const ROWS = 16;
export const colsFor = (kind) => (kind === 'trailer' ? 32 : 16);
export const emptyDecal = (kind) => '0'.repeat(colsFor(kind) * ROWS);
export const validDecal = (str, kind) => typeof str === 'string' && str.length === colsFor(kind) * ROWS && /^[0-9a-f]+$/.test(str);
export const isBlank = (str) => !str || /^0+$/.test(str);
// keys in the profile: "v:<vehicleId>" and "t:<trailerId>"
