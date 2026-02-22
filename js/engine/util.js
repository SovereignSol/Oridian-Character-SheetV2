export function clampInt(v,min,max){const n=Number(v);const i=Number.isFinite(n)?Math.trunc(n):min;return Math.max(min,Math.min(max,i));}
