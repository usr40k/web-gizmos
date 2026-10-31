// Content schema: the single source of truth for what a content pack may contain.
// The validator (validate.js), the in-game loader, `tools/validate-content.mjs` and the docs all read this.
// To add a new FIELD to an existing type: add it here, then read it where it is used. To add a new TYPE: add it here
// and give it a plural key in a pack. Most contributors never need to touch this file - they only write packs.

export const SLOTS = ['engine', 'tires', 'tank', 'body'];
export const STATS = ['accel', 'topSpeed', 'grip', 'offroad', 'fuelCap', 'efficiency'];
export const SHAPES = ['tree', 'pine', 'cactus', 'rock', 'crystal', 'mushroom', 'box'];
export const KINDS = ['gas_station', 'shop', 'race_pad', 'dealer', 'decor'];
export const SERVICES = ['gas_station', 'shop', 'race_pad', 'dealer'];       // building kinds a settlement can guarantee

const ID = { type: 'string', required: true, pattern: '^[a-z0-9_]+$', max: 40,
  doc: 'Unique lowercase id: letters a-z, digits, underscore. Never reuse an id from another pack.' };
const NAME = (doc = 'Display name shown to players.') => ({ type: 'string', required: true, max: 32, doc });
const color = (def, doc) => ({ type: 'color', default: def, doc });

export const SCHEMA = {
  biome: {
    plural: 'biomes',
    doc: 'A region of the world with its own palette, props, roadside buildings and shop stock. Add new biomes freely; the world generator picks them by weight.',
    fields: {
      id: ID,
      name: NAME('Name shown in the "Entering ..." banner.'),
      weight: { type: 'number', min: 0.1, max: 10, default: 1, doc: 'How common this biome is (1 = normal, 2 = twice as common).' },
      scale: { type: 'number', min: 1, max: 15, default: 5, doc: 'About how many MINUTES it takes to drive across this biome (1 = tiny, 15 = vast). Bigger scale = bigger regions.' },
      patch: { type: 'bool', default: false, doc: 'true = a small patch biome (oasis, crater...) that appears inside bigger biomes instead of forming its own region. Use scale 1 to 2.5.' },
      inside: { type: 'list', of: { type: 'ref', ref: 'biome' }, doc: 'Only for patch biomes: ids of the biomes this patch may appear in. Empty = anywhere.' },
      start: { type: 'bool', default: false, doc: 'true on ONE biome only: the world spawns the player in it. Leave false in your own packs.' },
      palette: {
        type: 'object', required: true, doc: 'Colors. Use #rrggbb hex.',
        fields: {
          ground: { type: 'list', of: { type: 'color' }, min: 1, max: 8, required: true, doc: '1-8 similar ground colors; tiles pick randomly for texture.' },
          road: color('#3b3b44', 'Asphalt color.'),
          roadLine: color('#e6e6c0', 'Center-line dash color.'),
          speck: { type: 'color', optional: true, doc: 'Optional color for tiny ground detail pixels (grass tufts, sparkles...).' },
        },
      },
      terrain: {
        type: 'object', doc: 'Off-road surface behaviour (anything that is not road).',
        fields: {
          grip: { type: 'number', min: 0.1, max: 2, default: 0.75, doc: '1 = like asphalt, 0.3 = ice, 0.6 = sand.' },
          drag: { type: 'number', min: 0, max: 4, default: 1, doc: 'Slowdown. 0.35 = like asphalt, 1.6 = deep sand.' },
        },
      },
      roadSurface: {
        type: 'object', doc: 'Road behaviour in this biome (icy roads, oily roads...).',
        fields: {
          grip: { type: 'number', min: 0.1, max: 2, default: 1 },
          drag: { type: 'number', min: 0, max: 4, default: 0.35 },
        },
      },
      props: {
        type: 'list', doc: 'Scenery scattered over the ground. density = chance per tile (0.05 = 1 in 20 tiles).',
        of: { type: 'object', fields: {
          prop: { type: 'ref', ref: 'prop', required: true },
          density: { type: 'number', min: 0, max: 0.5, required: true },
        } },
      },
      roadside: {
        type: 'list', doc: 'Buildings that can appear beside roads. chance = probability per roadside slot; the chances of one biome should add up to <= 1.',
        of: { type: 'object', fields: {
          building: { type: 'ref', ref: 'building', required: true },
          chance: { type: 'number', min: 0, max: 1, required: true },
        } },
      },
      homes: {
        type: 'list', doc: 'Decor buildings (houses, offices) this biome uses to fill towns. chance = relative weight. Empty = only the settlement\'s own buildings.',
        of: { type: 'object', fields: { building: { type: 'ref', ref: 'building', required: true }, chance: { type: 'number', min: 0, max: 100, required: true } } },
      },
      shopStock: { type: 'list', of: { type: 'ref', ref: 'part' }, doc: 'Part ids sold by shops in this biome. Different biomes = different stock.' },
      fuelPrice: { type: 'number', min: 0.2, max: 6, default: 1, doc: 'Multiplier on the base fuel price.' },
      wrecks: { type: 'number', min: 0, max: 1, default: 0.15, doc: 'How often salvageable wrecks sit beside highways (0 = never).' },
      coins: { type: 'number', min: 0, max: 1, default: 0.25, doc: 'How often cash trails appear on roads (0 = never).' },
    },
  },

  prop: {
    plural: 'props',
    doc: 'A piece of scenery. The SHAPE decides how it is drawn; you only choose colors and size.',
    fields: {
      id: ID,
      shape: { type: 'enum', values: SHAPES, required: true, doc: 'tree | pine | cactus | rock | crystal | mushroom | box' },
      color: { type: 'color', required: true, doc: 'Main color (tree: leaves, pine: needles, rock: body, crystal: gem, mushroom: cap, box: walls).' },
      color2: { type: 'color', optional: true, doc: 'Accent (tree: trunk, pine: snow on top, mushroom: stem, box: roof). Optional.' },
      size: { type: 'number', min: 0.4, max: 3, default: 1, doc: '1 = normal.' },
      solid: { type: 'bool', default: true, doc: 'Cars crash into it.' },
      radius: { type: 'number', min: 0.1, max: 2, default: 0.4, doc: 'Collision radius in tiles (only if solid).' },
    },
  },

  building: {
    plural: 'buildings',
    doc: 'A roadside building. KIND decides what it does (sell fuel, sell parts, start a race); everything else is looks.',
    fields: {
      id: ID,
      name: NAME(),
      kind: { type: 'enum', values: KINDS, required: true, doc: 'gas_station | shop | race_pad | dealer (sells vehicles) | decor (decor = a house/tower that does nothing, used to fill towns)' },
      color: { type: 'color', required: true, doc: 'Wall color.' },
      roof: { type: 'color', optional: true, doc: 'Roof color (defaults to a lighter wall color).' },
      accent: color('#ffd24a', 'Sign and trim color.'),
      width: { type: 'int', min: 2, max: 9, default: 5, doc: 'Size along the road, in tiles.' },
      depth: { type: 'int', min: 2, max: 9, default: 4, doc: 'Size away from the road, in tiles.' },
      height: { type: 'int', min: 3, max: 40, default: 14, doc: 'Height in pixels.' },
      sign: { type: 'string', max: 8, optional: true, doc: 'Sign text, up to 8 characters (A-Z, 0-9 . - ! $).' },
      race: { type: 'ref', ref: 'race', optional: true, doc: 'REQUIRED when kind is race_pad: which race it starts.' },
    },
  },

  part: {
    plural: 'parts',
    doc: 'A car part. Players equip one part per slot. Stats are ADDED to the base car; unlisted stats count as 0.',
    fields: {
      id: ID,
      name: NAME(),
      slot: { type: 'enum', values: SLOTS, required: true, doc: 'engine | tires | tank | body' },
      price: { type: 'int', min: 0, max: 100000, required: true, doc: 'Cost. Price 0 = free starter part (every slot needs at least one).' },
      desc: { type: 'string', max: 80, optional: true, doc: 'One-line flavor text.' },
      stats: {
        type: 'object', doc: 'Numbers added to the base car (can be negative for trade-offs).',
        fields: {
          accel: { type: 'number', min: -8, max: 20, default: 0, doc: 'Acceleration (base 9).' },
          topSpeed: { type: 'number', min: -10, max: 30, default: 0, doc: 'Top speed in tiles/s (base 14).' },
          grip: { type: 'number', min: -4, max: 6, default: 0, doc: 'Cornering grip (base 5).' },
          offroad: { type: 'number', min: -1, max: 1, default: 0, doc: 'Reduces off-road penalties: +0.3 = much better on sand/ice/mud.' },
          fuelCap: { type: 'number', min: -20, max: 100, default: 0, doc: 'Tank size in litres (base 30).' },
          efficiency: { type: 'number', min: -0.5, max: 0.8, default: 0, doc: '+0.1 = 10% less fuel burned; negative = thirstier.' },
        },
      },
    },
  },

  settlement: {
    plural: 'settlements',
    doc: 'A town on a highway crossroads, sparse and far apart. It gets its own street grid, a few guaranteed services at the crossroads, and filler buildings. Add new sizes or flavours freely.',
    fields: {
      id: ID,
      name: NAME('Type name, e.g. "Village".'),
      size: { type: 'enum', values: ['outpost', 'village', 'town', 'city'], required: true, doc: 'Just a label for humans; the numbers below decide the real size.' },
      radius: { type: 'int', min: 16, max: 400, default: 70, doc: 'Half-width of the town in tiles (outpost 30, village 75, town 150, city 260).' },
      block: { type: 'int', min: 22, max: 44, default: 30, doc: 'Distance between streets in tiles.' },
      density: { type: 'number', min: 0, max: 1, default: 0.6, doc: 'Fraction of lots that get a building.' },
      weight: { type: 'number', min: 0.05, max: 20, default: 1, doc: 'How common (outposts are common, cities rare).' },
      starter: { type: 'bool', default: false, doc: 'true on ONE settlement: it is placed at the spawn point. Leave false in your own packs.' },
      inside: { type: 'list', of: { type: 'ref', ref: 'biome' }, doc: 'Only appear in these biomes. Empty = anywhere.' },
      services: { type: 'list', of: { type: 'enum', values: SERVICES }, doc: 'Up to 4 building KINDS guaranteed around the crossroads, e.g. ["gas_station", "shop"]. The look comes from the biome.' },
      buildings: {
        type: 'list', doc: 'Extra filler buildings for this settlement type (towers, warehouses...). chance = relative weight, mixed with the biome homes.',
        of: { type: 'object', fields: { building: { type: 'ref', ref: 'building', required: true }, chance: { type: 'number', min: 0, max: 100, required: true } } },
      },
    },
  },

  vehicle: {
    plural: 'vehicles',
    doc: 'A drivable vehicle base. Sold at dealers. Parts are added on top of these numbers. l100 is REAL-WORLD fuel use (litres per 100 km) of that class; the game stretches 1 tile to 100 m for fuel, so a sedan (8 L/100km) goes about 10 minutes on a tank. Tip: copy a sibling vehicle and change numbers.',
    fields: {
      id: ID,
      name: NAME('e.g. "Pickup".'),
      shape: { type: 'enum', values: ['sedan', 'wagon', 'suv', 'pickup', 'van', 'tow', 'semi'], required: true, doc: 'Which body is drawn.' },
      price: { type: 'int', min: 0, max: 1000000, required: true, doc: '0 = free starter (at least one vehicle must cost 0).' },
      desc: { type: 'string', max: 80, optional: true },
      length: { type: 'number', min: 1.2, max: 4, default: 1.64, doc: 'Tiles long (sedan 1.64). Longer vehicles are also harder to turn.' },
      width: { type: 'number', min: 0.6, max: 1.6, default: 0.88 },
      height: { type: 'number', min: 2, max: 10, default: 4.5, doc: 'Pixel height of the roof.' },
      accel: { type: 'number', min: 2, max: 20, default: 9 },
      topSpeed: { type: 'number', min: 5, max: 30, default: 14, doc: 'Tiles per second.' },
      grip: { type: 'number', min: 1, max: 10, default: 5 },
      offroad: { type: 'number', min: 0, max: 1, default: 0 },
      turn: { type: 'number', min: 0.8, max: 3.5, default: 2.4, doc: 'Steering rate (semis 1.5, sedan 2.4).' },
      brake: { type: 'number', min: 6, max: 40, default: 20 },
      fuelCap: { type: 'number', min: 10, max: 1000, default: 50, doc: 'Tank litres.' },
      coupling: { type: 'enum', values: ['ball', 'fifth'], default: 'ball', doc: 'ball = bumper hitch trailers; fifth = semi tractors with fifth-wheel trailers.' },
      tow: { type: 'number', min: 0, max: 3, default: 0.4, doc: 'Heaviest trailer load it can pull (trailer.load, 0.3 light ... 1.2 heavy).' },
      l100: { type: 'number', min: 2, max: 80, default: 8, doc: 'Real-world average litres per 100 km: sedan 8, wagon 7.5, van 11, SUV 12.5, pickup 13, tow truck 25, semi 32-40.' },
    },
  },

  trailer: {
    plural: 'trailers',
    doc: 'A real hinged trailer. It swings behind the vehicle and can jackknife. Sold at dealers. coupling must match the vehicle (ball or fifth) and load must not exceed the vehicle tow rating.',
    fields: {
      id: ID,
      name: NAME('e.g. "Box trailer".'),
      shape: { type: 'enum', values: ['open', 'box', 'flatbed', 'tanker'], required: true, doc: 'Which body is drawn.' },
      coupling: { type: 'enum', values: ['ball', 'fifth'], default: 'ball' },
      price: { type: 'int', min: 0, max: 1000000, required: true },
      desc: { type: 'string', max: 80, optional: true },
      length: { type: 'number', min: 1, max: 8, default: 2.2, doc: 'Tiles long.' },
      width: { type: 'number', min: 0.5, max: 1.6, default: 0.9 },
      height: { type: 'number', min: 2, max: 12, default: 5, doc: 'Pixel height of the roof/sides.' },
      load: { type: 'number', min: 0, max: 3, default: 0.5, doc: 'How heavy. Slows acceleration/top speed and raises fuel use (0.3 light, 1 loaded semi trailer).' },
      color: { type: 'color', default: '#d8d8dc' },
      accent: { type: 'color', default: '#3a6ad0' },
    },
  },

  wreck: {
    plural: 'wrecks',
    doc: 'A broken-down vehicle beside a highway. Press E next to it to salvage cash and fuel; it comes back after a while.',
    fields: {
      id: ID,
      name: NAME('Shown in the prompt, e.g. "Rusty sedan".'),
      color: { type: 'color', default: '#8a5a44' },
      accent: { type: 'color', default: '#d9d2c0' },
      length: { type: 'number', min: 2, max: 12, default: 4.2, doc: 'Tiles long.' },
      width: { type: 'number', min: 1, max: 5, default: 2, doc: 'Tiles wide.' },
      height: { type: 'number', min: 1, max: 20, default: 3 },
      weight: { type: 'number', min: 0.05, max: 20, default: 1, doc: 'How common.' },
      cash: { type: 'int', min: 0, max: 2000, default: 40, doc: 'Maximum cash found (you get 30-100% of it).' },
      fuel: { type: 'int', min: 0, max: 100, default: 6, doc: 'Maximum litres siphoned (30-100% of it).' },
    },
  },

  race: {
    plural: 'races',
    doc: 'A time trial that a race_pad building can start. Checkpoints are laid out along the road automatically.',
    fields: {
      id: ID,
      name: NAME(),
      checkpoints: { type: 'int', min: 2, max: 12, default: 4 },
      spacing: { type: 'number', min: 10, max: 90, default: 30, doc: 'Tiles between checkpoints.' },
      parTime: { type: 'number', min: 8, max: 900, default: 30, doc: 'Seconds. Finishing at par pays the full payout; faster pays up to 1.5x.' },
      payout: { type: 'int', min: 0, max: 100000, default: 300 },
    },
  },
};

// keys allowed at the top level of a pack besides the plural type keys
export const PACK_META = ['id', 'name', 'author', 'description'];
