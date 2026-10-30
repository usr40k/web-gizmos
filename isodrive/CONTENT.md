# Adding content to Isodrive

Content (biomes, scenery, buildings, car parts, races) is **plain data**. You never touch game code to add it.
A mistake in a pack can never crash the game: the bad item is skipped and the problem is listed in the red
"content problems" box in-game and in the browser console.

## The 5-step workflow

1. Copy `content/packs/_template.js` to `content/packs/<yourname>.js`.
2. Rename every `id` (prefix with your name: `sam_swamp`, `sam_snorkel`). Ids must be unique across all packs.
3. Delete what you do not need. Every section is optional.
4. Check it: `node tools/validate-content.mjs content/packs/<yourname>.js` (Node 18+, no install needed).
   Fix every `ERROR` line; each one says the exact field and what is allowed.
5. Try it without editing anything else: open `index.html?pack=<yourname>` (served over http, e.g. `python3 -m http.server`).
   When happy, add `'./packs/<yourname>.js',` to `content/manifest.js`.

`node tools/validate-content.mjs --schema` prints every field of every type with its limits. That output is the
authority; this file is the friendly version.

## What each type is

| Type | Is | Needs |
|------|----|-------|
| `biomes` | A region: colors, slipperiness, scenery, roadside buildings, shop stock, fuel price | `id`, `name`, `palette.ground` |
| `props` | One piece of scenery. `shape` picks the drawing, you pick colors/size | `id`, `shape`, `color` |
| `buildings` | Roadside building. `kind` = `gas_station`, `shop` or `race_pad` | `id`, `name`, `kind`, `color` (+ `race` for `race_pad`) |
| `parts` | A car part for slot `engine`, `tires`, `tank` or `body` | `id`, `name`, `slot`, `price` |
| `races` | A time trial a `race_pad` starts | `id`, `name` |

Things refer to each other **by id**: a biome lists prop ids, building ids and part ids; a `race_pad` building names a race id.
You can refer to ids from other packs (including `base`). A reference to an id that does not exist skips the item
and tells you which one is missing.

## Rules of thumb that keep the game fun

- Colors are `"#rrggbb"`. Give each biome a *distinct* palette: dark ground with a bright `roadLine` reads well, and
  neighbouring biomes should differ in hue, not just brightness.
- `terrain.grip` / `terrain.drag` are the off-road feel (1 = asphalt). Ice about 0.3, sand 0.55 with drag 1.6, mud 0.5 with drag 1.8.
  `roadSurface` does the same for the road itself (icy roads, oily roads).
- `props[].density` is per tile; 0.02 to 0.05 is a normal forest. Above 0.1 is a jungle and can cost frame rate.
- Building `chance` values in one biome should add up to 1 or less, since each roadside slot picks at most one.
  Leave room (about 0.5 total) so most slots stay empty.
- Part `stats` are **added** to the base car (accel 9, topSpeed 14, grip 5, fuelCap 30L, offroad 0, efficiency 0).
  Strong part = expensive part, and give it a downside (`efficiency: -0.1`) when it is a big upgrade.
  Price guide: small upgrade 250 to 350, big upgrade 700 or more. A fresh player has $150 and earns about $300 per race.
- Every slot must have one `price: 0` starter part. The base pack already has them; do not add another free part.
- A new biome only shows up if its `weight` is > 0. `weight: 1` is as common as the other base biomes.
- Only the base pack sets `start: true`. Leave it out.

## Recipes

**New part** (add to `parts`):
```js
{ id: 'sam_nitro', name: 'Nitro Kit', slot: 'engine', price: 900, desc: 'Boom.', stats: { accel: 7, topSpeed: 4, efficiency: -0.25 } }
```
Then put `'sam_nitro'` in the `shopStock` of a biome **in your own pack** so it can be bought (a pack cannot edit another pack's biomes).

**New biome** that sells it (add to `biomes`; copy the swamp from the template and change names/colors).

**New scenery**: pick a `shape` (`tree`, `pine`, `cactus`, `rock`, `crystal`, `mushroom`, `box`), set `color` (and `color2`), add it to a biome's `props`.

**New race**: add to `races`, then add a `race_pad` building with `race: '<race id>'` and list that building in a biome's `roadside`.

## Prompt to paste into an AI assistant

> I am adding content to Isodrive, a data-driven browser game. Read `content/packs/_template.js` and
> `content/packs/base.js` in this repo, then write ONE new content pack file `content/packs/<name>.js` that
> adds: <describe what you want, e.g. "a candy biome with pink ground, 3 new props, a shop selling a 'sugar rush' engine and a 40s race">.
> Rules: output only a JavaScript file with `export default { ... }`; no imports, no functions, no comments needed;
> ids lowercase_with_underscores prefixed with `<name>_`; colors `#rrggbb`; only use fields that appear in the template;
> reference existing ids from base.js where useful. Then run `node tools/validate-content.mjs content/packs/<name>.js`
> and fix every ERROR it prints until it says OK.

## Beyond data: new shapes, new building kinds, new stats

These need a code change, and each has exactly one place to start:

- New prop **shape**: add a function to `SHAPE` in `js/render/sprites.js` and its name to `SHAPES` in `js/content/schema.js`.
- New building **kind**: add it to `KINDS` in the schema, then handle it in `promptFor()` in `js/game/game.js`.
- New part **stat**: add it to `STATS`/the `part.stats` fields in the schema, `BASE` in `js/game/car.js`, and use it in physics.
- New **field** on anything: add it to `js/content/schema.js` and read it where you need it. The validator, the
  `--schema` printout and the in-game loader all follow the schema automatically.
