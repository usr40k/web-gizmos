// ============================================================================
//  ISODRIVE CONTENT PACK TEMPLATE
//  1. Copy this file to  content/packs/<yourname>.js   (keep the leading _ only on this template)
//  2. Change the ids below (they must be unique across all packs - prefix them with your name, e.g. "sam_")
//  3. Delete the sections you do not need. Every section is optional.
//  4. Add a line to content/manifest.js:   './packs/<yourname>.js',
//     (or test first without editing anything: open the game with  ?pack=<yourname> )
//  5. Check it:   node tools/validate-content.mjs content/packs/<yourname>.js
//  Colors are "#rrggbb". Full field list: node tools/validate-content.mjs --schema   (or read CONTENT.md)
// ============================================================================
export default {
  id: 'example', name: 'Example pack', author: 'you',

  biomes: [{
    id: 'example_swamp', name: 'Mirewood Swamp',
    weight: 1,                                    // how common (1 = normal)
    palette: {
      ground: ['#3f5a3a', '#37513a', '#476843'],  // 1-8 similar colors
      road: '#3a3a30', roadLine: '#d8d89a',
      speck: '#7fa05a',                           // optional
    },
    terrain: { grip: 0.5, drag: 1.4 },            // off-road: 1 = like asphalt; lower grip = slidier
    props: [                                      // prop ids (from any pack) + density per tile
      { prop: 'example_dead_log', density: 0.03 },
      { prop: 'oak', density: 0.02 },
    ],
    roadside: [                                   // buildings next to roads; chances should sum to <= 1
      { building: 'gas_std', chance: 0.3 },
      { building: 'example_shop', chance: 0.25 },
    ],
    shopStock: ['tires_offroad', 'example_snorkel'],  // part ids sold here
    fuelPrice: 1.1,
    coins: 0.25,
  }],

  props: [{
    id: 'example_dead_log', shape: 'rock',        // tree | pine | cactus | rock | crystal | mushroom | box
    color: '#5a4630', size: 1, solid: true, radius: 0.4,
  }],

  buildings: [{
    id: 'example_shop', name: 'Bog Parts', kind: 'shop',   // gas_station | shop | race_pad
    color: '#6b8a5a', accent: '#ffd24a', width: 6, depth: 4, height: 14, sign: 'PARTS',
  }],

  parts: [{
    id: 'example_snorkel', name: 'Snorkel Kit', slot: 'body',   // engine | tires | tank | body
    price: 400, desc: 'Wading is fine now.',
    stats: { offroad: 0.3, efficiency: -0.05 },       // accel topSpeed grip offroad fuelCap efficiency
  }],

  races: [{
    id: 'example_race', name: 'Swamp Run', checkpoints: 5, spacing: 28, parTime: 28, payout: 400,
  }],
};
