// Example add-on pack (NOT in manifest.js). Try it with:  index.html?pack=example_candy
// Shows: a new biome, new props, new buildings, a new part and a new race, reusing ids from the base pack.
export default {
  id: 'example_candy', name: 'Candy Coast (example)', author: 'example',
  biomes: [{
    id: 'candy_coast', name: 'Candy Coast', weight: 2,
    palette: { ground: ['#ffb3d9', '#ffc2e0', '#ffa6d2', '#ffd1e8'], road: '#6b4a5a', roadLine: '#ffffff', speck: '#ffffff' },
    terrain: { grip: 0.45, drag: 1.2 },
    props: [{ prop: 'candy_cane', density: 0.03 }, { prop: 'gumdrop', density: 0.03 }, { prop: 'oak', density: 0.005 }],
    roadside: [{ building: 'gas_std', chance: 0.25 }, { building: 'candy_shop', chance: 0.3 }, { building: 'candy_pad', chance: 0.12 }],
    shopStock: ['candy_engine', 'tires_sport', 'tank_long'],
    fuelPrice: 0.9, coins: 0.4,
  }],
  props: [
    { id: 'candy_cane', shape: 'pine', color: '#ff4a6e', color2: '#ffffff', size: 1.1, radius: 0.3 },
    { id: 'gumdrop', shape: 'mushroom', color: '#7affc4', color2: '#ffffff', size: 1.2, solid: false },
  ],
  buildings: [
    { id: 'candy_shop', name: 'Sugar Garage', kind: 'shop', color: '#ff8fc8', roof: '#ffffff', accent: '#6b2fff', width: 6, depth: 4, height: 14, sign: 'SWEET' },
    { id: 'candy_pad', name: 'Sugar Dash', kind: 'race_pad', color: '#ff8fc8', accent: '#ffffff', width: 3, depth: 3, height: 4, sign: 'DASH', race: 'candy_run' },
  ],
  parts: [{ id: 'candy_engine', name: 'Sugar Rush', slot: 'engine', price: 500, desc: 'Sweet speed, sour mileage.', stats: { accel: 4, topSpeed: 3, efficiency: -0.1 } }],
  races: [{ id: 'candy_run', name: 'Candy Run', checkpoints: 5, spacing: 28, parTime: 26, payout: 380 }],
};
