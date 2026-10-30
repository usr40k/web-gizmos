// Tiny schema validator. Produces normalized values (defaults filled in) plus
// human/LLM-readable messages that say exactly which field is wrong and what is expected.

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normColor(c) {
  c = c.toLowerCase();
  return c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
}

export function describe(spec) {
  switch (spec.type) {
    case 'color': return 'a color like "#33aa55"';
    case 'enum': return `one of ${spec.values.map((v) => `"${v}"`).join(', ')}`;
    case 'number': return `a number${spec.min !== undefined ? ` between ${spec.min} and ${spec.max}` : ''}`;
    case 'int': return `a whole number${spec.min !== undefined ? ` between ${spec.min} and ${spec.max}` : ''}`;
    case 'string': return spec.pattern ? `a string matching ${spec.pattern}` : 'a string';
    case 'bool': return 'true or false';
    case 'ref': return `the id of an existing ${spec.ref}`;
    case 'list': return 'a list [ ... ]';
    case 'object': return 'an object { ... }';
    default: return spec.type;
  }
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function closest(key, options) {
  let best = null, bd = 3;
  for (const o of options) { const d = lev(key.toLowerCase(), o.toLowerCase()); if (d < bd) { bd = d; best = o; } }
  return best;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ctx = { errors: [], warnings: [], refs: [] }
export function validateValue(spec, v, path, ctx) {
  if (v === undefined || v === null) {
    if (spec.required) { ctx.errors.push(`${path}: missing required field (expected ${describe(spec)})`); return undefined; }
    if (spec.type === 'object') v = {};
    else if (spec.type === 'list') return [];
    else return clone(spec.default);
  }
  switch (spec.type) {
    case 'string': {
      if (typeof v !== 'string') { ctx.errors.push(`${path}: ${JSON.stringify(v)} is not a string`); return undefined; }
      if (spec.pattern && !new RegExp(spec.pattern).test(v)) { ctx.errors.push(`${path}: "${v}" must match ${spec.pattern}`); return undefined; }
      if (spec.max && v.length > spec.max) { ctx.warnings.push(`${path}: truncated to ${spec.max} characters`); v = v.slice(0, spec.max); }
      return v;
    }
    case 'number': case 'int': {
      if (typeof v !== 'number' || !Number.isFinite(v)) { ctx.errors.push(`${path}: ${JSON.stringify(v)} is not a number (expected ${describe(spec)})`); return undefined; }
      if (spec.type === 'int' && !Number.isInteger(v)) { ctx.warnings.push(`${path}: ${v} rounded to a whole number`); v = Math.round(v); }
      if (spec.min !== undefined && v < spec.min) { ctx.warnings.push(`${path}: ${v} is below ${spec.min}, using ${spec.min}`); v = spec.min; }
      if (spec.max !== undefined && v > spec.max) { ctx.warnings.push(`${path}: ${v} is above ${spec.max}, using ${spec.max}`); v = spec.max; }
      return v;
    }
    case 'bool':
      if (typeof v !== 'boolean') { ctx.errors.push(`${path}: ${JSON.stringify(v)} must be true or false`); return undefined; }
      return v;
    case 'color':
      if (typeof v !== 'string' || !HEX.test(v)) { ctx.errors.push(`${path}: ${JSON.stringify(v)} is not a valid color (use "#rrggbb")`); return undefined; }
      return normColor(v);
    case 'enum':
      if (!spec.values.includes(v)) {
        const guess = typeof v === 'string' ? closest(v, spec.values) : null;
        ctx.errors.push(`${path}: ${JSON.stringify(v)} is not allowed; expected ${describe(spec)}${guess ? ` (did you mean "${guess}"?)` : ''}`);
        return undefined;
      }
      return v;
    case 'ref':
      if (typeof v !== 'string') { ctx.errors.push(`${path}: must be the id string of a ${spec.ref}`); return undefined; }
      ctx.refs.push({ type: spec.ref, id: v, path });
      return v;
    case 'list': {
      if (!Array.isArray(v)) { ctx.errors.push(`${path}: must be a list [ ... ]`); return undefined; }
      if (spec.min !== undefined && v.length < spec.min) { ctx.errors.push(`${path}: needs at least ${spec.min} item(s)`); return undefined; }
      if (spec.max !== undefined && v.length > spec.max) { ctx.warnings.push(`${path}: only the first ${spec.max} items are used`); v = v.slice(0, spec.max); }
      return v.map((item, i) => validateValue(spec.of, item, `${path}[${i}]`, ctx));
    }
    case 'object': {
      if (typeof v !== 'object' || Array.isArray(v)) { ctx.errors.push(`${path}: must be an object { ... }`); return undefined; }
      const out = {};
      const known = Object.keys(spec.fields || {});
      for (const k of Object.keys(v)) {
        if (!known.includes(k)) {
          const guess = closest(k, known);
          ctx.warnings.push(`${path}.${k}: unknown field, ignored${guess ? ` (did you mean "${guess}"?)` : ''}`);
        }
      }
      for (const [k, fs] of Object.entries(spec.fields || {})) {
        const r = validateValue(fs, v[k], `${path}.${k}`, ctx);
        if (r !== undefined) out[k] = r;
      }
      return out;
    }
    default:
      ctx.errors.push(`${path}: schema bug, unknown type ${spec.type}`);
      return undefined;
  }
}
