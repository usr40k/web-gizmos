// Base content pack. Look at this file for working examples of every content type.
// Colors are "#rrggbb". Ids are lowercase_with_underscores and must be unique across ALL packs.
export default {
  id: 'base',
  name: 'Isodrive base pack',
  author: 'usr40k',

  // ---------------------------------------------------------------- biomes
  biomes: [
    {
      id: 'meadow', scale: 4, name: 'Greenwood Meadows', start: true, weight: 2,
      palette: { ground: ['#5fa34a', '#58994a', '#67ad52', '#4f9145'], road: '#4b4b55', roadLine: '#e8e4b8', speck: '#86d26e' },
      terrain: { grip: 0.75, drag: 1.0 },
      props: [{ prop: 'oak', density: 0.05 }, { prop: 'pine_green', density: 0.025 }, { prop: 'boulder_grey', density: 0.01 }],
      roadside: [{ building: 'gas_std', chance: 0.3 }, { building: 'shop_std', chance: 0.25 }, { building: 'race_pad_std', chance: 0.1 }],
      homes: [{ building: 'house_std', chance: 1 }, { building: 'house_red', chance: 0.6 }],
      shopStock: ['engine_v6', 'tires_sport', 'tank_long', 'body_aero'],
      fuelPrice: 1.0, coins: 0.3,
    },
    {
      id: 'desert', scale: 8, name: 'Sunscar Desert', weight: 1.5,
      palette: { ground: ['#e9bf72', '#e2b565', '#edc57d', '#dcab5c'], road: '#5a4a40', roadLine: '#f6e7a0', speck: '#f7d88f' },
      terrain: { grip: 0.55, drag: 1.6 },
      props: [{ prop: 'cactus_green', density: 0.025 }, { prop: 'sandrock', density: 0.02 }],
      roadside: [{ building: 'gas_adobe', chance: 0.3 }, { building: 'shop_adobe', chance: 0.2 }, { building: 'race_pad_std', chance: 0.1 }],
      homes: [{ building: 'house_adobe', chance: 1 }],
      shopStock: ['engine_turbo', 'tires_offroad', 'tank_long'],
      fuelPrice: 1.6, coins: 0.2,
    },
    {
      id: 'neon', scale: 3, name: 'Neon Flats', weight: 1,
      palette: { ground: ['#1a1233', '#20163d', '#161029', '#241946'], road: '#0b0b14', roadLine: '#00ffff', speck: '#6a3cff' },
      terrain: { grip: 0.9, drag: 0.9 },
      props: [{ prop: 'crystal_magenta', density: 0.02 }, { prop: 'crystal_cyan', density: 0.02 }, { prop: 'glowshroom', density: 0.015 }, { prop: 'pylon', density: 0.006 }],
      roadside: [{ building: 'gas_neon', chance: 0.3 }, { building: 'shop_neon', chance: 0.3 }, { building: 'race_pad_neon', chance: 0.12 }],
      homes: [{ building: 'house_neon', chance: 1 }],
      shopStock: ['engine_turbo', 'tires_sport', 'body_aero'],
      fuelPrice: 1.3, coins: 0.35,
    },
    {
      id: 'tundra', scale: 10, name: 'Frostline Tundra', weight: 1,
      palette: { ground: ['#e8f2fa', '#dceaf5', '#f2f8fd', '#d2e3f0'], road: '#5b6b7a', roadLine: '#ffffff', speck: '#ffffff' },
      terrain: { grip: 0.35, drag: 0.9 },          // slippery!
      roadSurface: { grip: 0.65, drag: 0.35 },     // icy roads
      props: [{ prop: 'pine_snow', density: 0.04 }, { prop: 'ice_rock', density: 0.015 }],
      roadside: [{ building: 'gas_frost', chance: 0.3 }, { building: 'shop_frost', chance: 0.3 }, { building: 'race_pad_std', chance: 0.08 }],
      homes: [{ building: 'house_frost', chance: 1 }],
      shopStock: ['tires_studded', 'tank_long', 'engine_v6'],
      fuelPrice: 1.2, coins: 0.25,
    },
    {
      id: 'ashlands', scale: 6, name: 'Cinder Ashlands', weight: 1,
      palette: { ground: ['#3a2b2b', '#332626', '#41302e', '#2d2222'], road: '#1a1a1d', roadLine: '#ff7a2a', speck: '#ff5a1f' },
      terrain: { grip: 0.6, drag: 1.3 },
      props: [{ prop: 'dead_tree', density: 0.03 }, { prop: 'ash_rock', density: 0.03 }, { prop: 'obsidian', density: 0.012 }],
      roadside: [{ building: 'gas_std', chance: 0.3 }, { building: 'shop_std', chance: 0.2 }, { building: 'race_pad_neon', chance: 0.1 }],
      homes: [{ building: 'house_ash', chance: 1 }],
      shopStock: ['engine_turbo', 'tires_offroad', 'body_aero'],
      fuelPrice: 0.8, coins: 0.2,
    },
    // ---- patch biomes: small areas (about a minute or two across) that appear INSIDE bigger biomes
    {
      id: 'oasis', name: 'Palm Oasis', patch: true, scale: 1.5, inside: ['desert'],
      palette: { ground: ['#4fae6a', '#46a262', '#5bbb74', '#3f9a5c'], road: '#5a4a40', roadLine: '#f6e7a0', speck: '#9be0a8' },
      terrain: { grip: 0.8, drag: 1.0 },
      props: [{ prop: 'palm', density: 0.06 }, { prop: 'sandrock', density: 0.01 }],
      roadside: [{ building: 'gas_adobe', chance: 0.45 }, { building: 'shop_adobe', chance: 0.35 }],
      homes: [{ building: 'house_adobe', chance: 1 }],
      shopStock: ['tank_long', 'tires_offroad'],
      fuelPrice: 2.2, coins: 0.5,
    },
    {
      id: 'ash_crater', name: 'Smoldering Crater', patch: true, scale: 1.2, inside: ['ashlands'],
      palette: { ground: ['#2a1414', '#331818', '#241010', '#3a1c1c'], road: '#140e0e', roadLine: '#ff5a1f', speck: '#ff8a2a' },
      terrain: { grip: 0.5, drag: 1.5 },
      props: [{ prop: 'obsidian', density: 0.04 }, { prop: 'ash_rock', density: 0.03 }],
      roadside: [],
      shopStock: [], fuelPrice: 1, coins: 0.6,
    },
  ],

  // ---------------------------------------------------------------- props
  props: [
    { id: 'oak', shape: 'tree', color: '#2f7d32', color2: '#6b4a2b', size: 1, radius: 0.35 },
    { id: 'pine_green', shape: 'pine', color: '#1f6a3a', size: 1.1, radius: 0.3 },
    { id: 'boulder_grey', shape: 'rock', color: '#8a8a92', size: 1, radius: 0.45 },
    { id: 'cactus_green', shape: 'cactus', color: '#3f8f45', size: 1, radius: 0.3 },
    { id: 'sandrock', shape: 'rock', color: '#b98a4a', size: 1.2, radius: 0.5 },
    { id: 'crystal_magenta', shape: 'crystal', color: '#ff2bd6', size: 1, radius: 0.3 },
    { id: 'crystal_cyan', shape: 'crystal', color: '#19f2ff', size: 1.3, radius: 0.35 },
    { id: 'glowshroom', shape: 'mushroom', color: '#ff7bd5', color2: '#f3e8ff', size: 1, solid: false },
    { id: 'pylon', shape: 'box', color: '#2a2a4a', color2: '#00ffff', size: 1.4, radius: 0.5 },
    { id: 'pine_snow', shape: 'pine', color: '#2b5d52', color2: '#ffffff', size: 1.2, radius: 0.3 },
    { id: 'ice_rock', shape: 'rock', color: '#a8c8e4', size: 1, radius: 0.45 },
    { id: 'dead_tree', shape: 'tree', color: '#3a2b2b', color2: '#2a1f1f', size: 0.9, radius: 0.3 },
    { id: 'ash_rock', shape: 'rock', color: '#4a3838', size: 1.1, radius: 0.5 },
    { id: 'palm', shape: 'tree', color: '#3fae5a', color2: '#8a6a3a', size: 1.2, radius: 0.3 },
    { id: 'obsidian', shape: 'crystal', color: '#ff5a1f', size: 1.2, radius: 0.35 },
  ],

  // ---------------------------------------------------------------- buildings
  buildings: [
    { id: 'gas_std', name: 'Fuel Stop', kind: 'gas_station', color: '#d94a4a', roof: '#f2f2f2', accent: '#ffd24a', width: 5, depth: 4, height: 12, sign: 'FUEL' },
    { id: 'gas_adobe', name: 'Dune Pumps', kind: 'gas_station', color: '#d98f55', accent: '#2aa6a6', width: 5, depth: 4, height: 11, sign: 'GAS' },
    { id: 'gas_neon', name: 'Volt Station', kind: 'gas_station', color: '#14142a', accent: '#00ffff', width: 5, depth: 4, height: 13, sign: 'VOLT' },
    { id: 'gas_frost', name: 'Thaw Pumps', kind: 'gas_station', color: '#6fa3c7', roof: '#ffffff', accent: '#ffffff', width: 5, depth: 4, height: 12, sign: 'FUEL' },
    { id: 'shop_std', name: 'Parts Barn', kind: 'shop', color: '#6a8cd9', accent: '#ffd24a', width: 6, depth: 4, height: 14, sign: 'PARTS' },
    { id: 'shop_adobe', name: 'Dune Bazaar', kind: 'shop', color: '#c9743f', accent: '#f0e040', width: 6, depth: 4, height: 13, sign: 'SHOP' },
    { id: 'shop_neon', name: 'Chrome Lab', kind: 'shop', color: '#2b1450', accent: '#ff2bd6', width: 6, depth: 4, height: 15, sign: 'LAB' },
    { id: 'shop_frost', name: 'Ice Garage', kind: 'shop', color: '#9fc4e0', roof: '#ffffff', accent: '#2a5a8a', width: 6, depth: 4, height: 14, sign: 'PARTS' },
    { id: 'dealership', name: 'Auto Dealer', kind: 'dealer', color: '#dfe6ee', roof: '#3a5a8a', accent: '#4a8af0', width: 9, depth: 6, height: 11, sign: 'CARS' },
    // decor: filler buildings for towns (kind 'decor' = no interaction)
    { id: 'house_std', name: 'House', kind: 'decor', color: '#e8dcc0', roof: '#a8483a', accent: '#6a8cd9', width: 4, depth: 4, height: 9 },
    { id: 'house_red', name: 'Brick House', kind: 'decor', color: '#b4574a', roof: '#4a3a3a', accent: '#ffe9a8', width: 5, depth: 4, height: 9 },
    { id: 'house_adobe', name: 'Adobe House', kind: 'decor', color: '#d9a066', roof: '#c98a50', accent: '#2aa6a6', width: 4, depth: 4, height: 8 },
    { id: 'house_neon', name: 'Neon Flat', kind: 'decor', color: '#1d1840', roof: '#2b1f66', accent: '#ff2bd6', width: 4, depth: 5, height: 14 },
    { id: 'house_frost', name: 'Cabin', kind: 'decor', color: '#8a6a4a', roof: '#ffffff', accent: '#ffd24a', width: 4, depth: 4, height: 8 },
    { id: 'house_ash', name: 'Bunker', kind: 'decor', color: '#4a4040', roof: '#2a2424', accent: '#ff7a2a', width: 5, depth: 4, height: 7 },
    { id: 'warehouse', name: 'Warehouse', kind: 'decor', color: '#8a96a4', roof: '#6a7482', accent: '#ffd24a', width: 9, depth: 6, height: 12 },
    { id: 'tower_office', name: 'Office Tower', kind: 'decor', color: '#6a86a8', roof: '#4a6280', accent: '#bfe6ff', width: 5, depth: 5, height: 38 },
    { id: 'race_pad_std', name: 'Time Trial', kind: 'race_pad', color: '#2b2b2b', accent: '#ffffff', width: 3, depth: 3, height: 4, sign: 'RACE', race: 'sprint' },
    { id: 'race_pad_neon', name: 'Neon Dash', kind: 'race_pad', color: '#14142a', accent: '#ff2bd6', width: 3, depth: 3, height: 4, sign: 'DASH', race: 'neon_dash' },
  ],

  // ---------------------------------------------------------------- settlements
  settlements: [
    { id: 'roadside_outpost', name: 'Outpost', size: 'outpost', radius: 30, block: 30, density: 0.4, weight: 5, services: ['gas_station'] },
    { id: 'village', name: 'Village', size: 'village', radius: 75, block: 30, density: 0.6, weight: 3, starter: true, services: ['gas_station', 'shop', 'race_pad'] },
    { id: 'town', name: 'Town', size: 'town', radius: 150, block: 32, density: 0.7, weight: 1.5, services: ['gas_station', 'shop', 'race_pad', 'dealer'], buildings: [{ building: 'warehouse', chance: 0.25 }] },
    { id: 'city', name: 'City', size: 'city', radius: 260, block: 34, density: 0.85, weight: 0.5, services: ['gas_station', 'shop', 'dealer', 'race_pad'], buildings: [{ building: 'tower_office', chance: 0.7 }, { building: 'warehouse', chance: 0.25 }] },
  ],

  vehicles: [
    { id: 'sedan', tow: 0.35, name: 'Sedan', shape: 'sedan', price: 0, desc: 'Cheap and frugal. 8 L/100km.', accel: 9, topSpeed: 14, grip: 5, fuelCap: 50, l100: 8 },
    { id: 'wagon', tow: 0.5, name: 'Station Wagon', shape: 'wagon', price: 1200, desc: 'Sips fuel, carries lots. 7.5 L/100km.', length: 1.8, accel: 8.5, topSpeed: 13.5, grip: 5, offroad: 0.1, fuelCap: 60, l100: 7.5, turn: 2.3 },
    { id: 'van', tow: 0.7, name: 'Van', shape: 'van', price: 2000, desc: 'Big tank, slow to turn. 11 L/100km.', length: 1.95, width: 0.95, height: 7, accel: 6.5, topSpeed: 11.5, grip: 4, offroad: 0.1, fuelCap: 70, l100: 11, turn: 2.0, brake: 18 },
    { id: 'suv', tow: 0.8, name: 'SUV', shape: 'suv', price: 2500, desc: 'Rough-road capable, thirsty. 12.5 L/100km.', length: 1.75, width: 0.95, height: 6, accel: 8, topSpeed: 13, grip: 4.6, offroad: 0.35, fuelCap: 70, l100: 12.5, turn: 2.2 },
    { id: 'pickup', tow: 1.0, name: 'Pickup', shape: 'pickup', price: 3000, desc: 'Tough and roomy. 13 L/100km.', length: 1.95, width: 0.95, height: 6, accel: 8, topSpeed: 13, grip: 4.4, offroad: 0.3, fuelCap: 80, l100: 13, turn: 2.1 },
    { id: 'tow_truck', tow: 1.2, name: 'Tow Truck', shape: 'tow', price: 6000, desc: 'Heavy diesel, big tank. 25 L/100km.', length: 2.3, width: 1.0, height: 7, accel: 6, topSpeed: 11, grip: 3.8, offroad: 0.25, fuelCap: 120, l100: 25, turn: 1.85, brake: 16 },
    { id: 'semi_2axle', name: 'Semi (2-axle)', shape: 'semi', price: 9000, desc: 'Road tractor, 26 L/100km bobtail, ~36 hauling.', length: 2.4, width: 1.0, height: 8, accel: 5, topSpeed: 10, grip: 3.5, offroad: 0.1, fuelCap: 200, l100: 26, coupling: 'fifth', tow: 1.5, turn: 1.6, brake: 14 },
    { id: 'semi_3axle', name: 'Semi (3-axle)', shape: 'semi', price: 14000, desc: 'Heavy haul tractor, 30 bobtail, ~42 hauling.', length: 2.7, width: 1.05, height: 8, accel: 4.5, topSpeed: 9.5, grip: 3.3, offroad: 0.15, fuelCap: 280, l100: 30, coupling: 'fifth', tow: 1.5, turn: 1.45, brake: 13 },
  ],

  trailers: [
    { id: 'utility_trailer', name: 'Utility Trailer', shape: 'open', price: 500, desc: 'Small open trailer. Light.', length: 1.5, width: 0.85, height: 4, load: 0.3, color: '#7a8088' },
    { id: 'box_trailer', name: 'Box Trailer', shape: 'box', price: 1400, desc: 'Enclosed cargo box.', length: 2.1, width: 0.9, height: 7, load: 0.55 },
    { id: 'cargo_trailer', name: 'Long Cargo Trailer', shape: 'box', price: 2800, desc: 'Big enclosed trailer for trucks.', length: 3.0, width: 0.95, height: 8, load: 0.95, accent: '#d0603a' },
    { id: 'semi_box', name: 'Semi Box Trailer', shape: 'box', coupling: 'fifth', price: 5000, desc: '53-foot style dry van.', length: 5.0, width: 1.05, height: 9, load: 1.0 },
    { id: 'semi_flatbed', name: 'Semi Flatbed', shape: 'flatbed', coupling: 'fifth', price: 4500, desc: 'Open deck for anything.', length: 5.0, width: 1.05, height: 5, load: 0.9, color: '#6c7480' },
    { id: 'semi_tanker', name: 'Semi Tanker', shape: 'tanker', coupling: 'fifth', price: 7000, desc: 'Heavy liquid hauler.', length: 4.6, width: 1.0, height: 8, load: 1.2, color: '#c8ccd2', accent: '#d0a030' },
  ],

  wrecks: [
    { id: 'wreck_sedan', name: 'Rusty sedan', color: '#8a5a44', length: 4.2, width: 2, height: 3, weight: 3, cash: 40, fuel: 5 },
    { id: 'wreck_pickup', name: 'Abandoned pickup', color: '#5a6e8a', length: 5, width: 2.1, height: 3.4, weight: 2, cash: 60, fuel: 9 },
    { id: 'wreck_bus', name: 'Burnt-out bus', color: '#a89a4a', length: 9, width: 2.6, height: 5, weight: 0.6, cash: 160, fuel: 20 },
    { id: 'wreck_van', name: 'Stripped van', color: '#9aa0a8', length: 5.2, width: 2.3, height: 4, weight: 1.5, cash: 70, fuel: 10 },
  ],

  // ---------------------------------------------------------------- parts (price 0 = free starter for that slot)
  parts: [
    { id: 'engine_stock', name: 'Stock 1.0L', slot: 'engine', price: 0, desc: 'Gets you to the shops.' },
    { id: 'engine_v6', name: 'V6 Sport', slot: 'engine', price: 320, desc: 'Noticeably punchier.', stats: { accel: 2.5, topSpeed: 2.5, efficiency: -0.05 } },
    { id: 'engine_turbo', name: 'Turbo Four', slot: 'engine', price: 780, desc: 'Fast and thirsty.', stats: { accel: 5, topSpeed: 5, efficiency: -0.15 } },
    { id: 'tires_stock', name: 'Stock Tires', slot: 'tires', price: 0 },
    { id: 'tires_sport', name: 'Sport Slicks', slot: 'tires', price: 250, desc: 'Great on tarmac.', stats: { grip: 1.5 } },
    { id: 'tires_offroad', name: 'Dirt Treads', slot: 'tires', price: 300, desc: 'Sand and mud stop being scary.', stats: { grip: 0.5, offroad: 0.35 } },
    { id: 'tires_studded', name: 'Studded Winters', slot: 'tires', price: 350, desc: 'Bites into ice.', stats: { grip: 1, offroad: 0.3 } },
    { id: 'tank_stock', name: 'Stock Tank', slot: 'tank', price: 0 },
    { id: 'tank_long', name: 'Long-Range Tank', slot: 'tank', price: 260, desc: '+25 litres.', stats: { fuelCap: 25 } },
    { id: 'body_stock', name: 'Stock Body', slot: 'body', price: 0 },
    { id: 'body_aero', name: 'Aero Kit', slot: 'body', price: 420, desc: 'Slippery shape, sips fuel.', stats: { topSpeed: 1.5, efficiency: 0.12 } },
  ],

  // ---------------------------------------------------------------- races
  races: [
    { id: 'sprint', name: 'Roadside Sprint', checkpoints: 4, spacing: 36, parTime: 22, payout: 300 },
    { id: 'neon_dash', name: 'Neon Dash', checkpoints: 6, spacing: 30, parTime: 30, payout: 520 },
  ],
};
