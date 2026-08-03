// Single source of truth. Imported by the browser AND by server.js.
// Edit questions here and both sides stay in sync.

export const DIMENSIONS = {
  water:     { name: 'Water',            weight: 1.5,  order: 1,
    note: 'Everything else on your land is downstream of this one.' },
  annuals:   { name: 'Annual food',      weight: 1.0,  order: 2,
    note: 'Fastest yields, most work. Where most people start and stop.' },
  perennial: { name: 'Perennial food',   weight: 1.25, order: 3,
    note: 'Longest lead time. A tree planted this spring feeds you in five years.' },
  animals:   { name: 'Animals & protein',weight: 1.0,  order: 4,
    note: 'Not just what you keep — whether you could keep feeding it.' },
  soil:      { name: 'Soil & fertility', weight: 1.25, order: 5,
    note: 'A site that imports all its fertility is renting its productivity.' },
  storage:   { name: 'Storage',          weight: 1.0,  order: 6,
    note: 'Growing food and keeping food are different skills.' },
  heat:      { name: 'Energy & heat',    weight: 1.5,  order: 7,
    note: 'No chinooks here. A cold snap stays.' },
  people:    { name: 'People & design',  weight: 1.25, order: 8,
    note: 'No amount of gear compensates for a site that was never designed.' }
};

const opts = (...labels) => labels.map((label, points) => ({ label, points }));

export const QUESTIONS = [
  // ---- profiling (unscored) ----
  { id: 'region', type: 'profile', text: 'Where is your land?',
    options: [
      { label: 'Edmonton (city)' },
      { label: 'Parkland County · Stony Plain · Spruce Grove' },
      { label: 'Sturgeon County · St. Albert · Morinville' },
      { label: 'Strathcona County · Sherwood Park · Fort Saskatchewan' },
      { label: 'Leduc County · Beaumont · Devon' },
      { label: 'Lac Ste. Anne · Westlock · further out' },
      { label: 'Elsewhere in Alberta' }
    ] },
  { id: 'size', type: 'profile', text: 'How much of it are you working with?',
    options: [
      { label: 'City lot — under a quarter acre' },
      { label: 'Small acreage — a quarter to 5 acres' },
      { label: 'Acreage — 5 to 40 acres' },
      { label: 'Farm or quarter section — 40 acres and up' },
      { label: 'Community, institution, or municipality' }
    ] },
  { id: 'tenure', type: 'profile', text: 'How long have you been working this site?',
    options: [
      { label: 'Just bought it, or about to' },
      { label: 'One to three years' },
      { label: 'Four to ten years' },
      { label: 'More than ten years' }
    ] },

  // ---- water ----
  { id: 'w1', dim: 'water', text: 'What water storage do you have on site?',
    options: opts(
      'None — municipal or hauled water only',
      'Rain barrels, under 1,000 litres all told',
      'A cistern or tank, 1,000 to 10,000 litres',
      'A pond, dugout, or cistern over 10,000 litres') },
  { id: 'w2', dim: 'water', text: 'The power goes out for a week in February. Can you still get water?',
    options: opts(
      'No — electric pump or municipal supply only',
      "I'd melt snow or haul it",
      'Generator backup for the pump',
      'Gravity-fed, hand pump, or solar — it runs without the grid') },
  { id: 'w3', dim: 'water', text: 'How much of the rain and snowmelt landing on your property do you keep?',
    help: 'The Edmonton region gets about 450 mm a year, most of it June through August.',
    options: opts(
      "None — it runs off, or I don't know",
      'Roof water into barrels',
      'Roof water plus some shaping of the land — berms, basins, dry creek beds',
      'Deliberate earthworks — swales, keyline, or contour ponds slowing water across the site') },

  // ---- annuals ----
  { id: 'a1', dim: 'annuals', text: 'How big is your annual vegetable garden?',
    options: opts(
      'None',
      'A few containers or one small bed',
      'A proper garden — roughly 200 to 1,000 square feet',
      'Over 1,000 square feet, planted for storage crops as well as fresh eating') },
  { id: 'a2', dim: 'annuals', text: 'What do you have for season extension?',
    help: 'Roughly 115 to 125 frost-free days here — last frost around the third week of May.',
    options: opts(
      'Nothing — I plant after the May long weekend and pull it in September',
      'Cold frames, low tunnels, or row cover',
      'An unheated greenhouse or high tunnel',
      'Heated or thermally buffered greenhouse — something growing most of the year') },
  { id: 'a3', dim: 'annuals', text: 'Where do your seeds and transplants come from?',
    options: opts(
      "Whatever's at the garden centre in spring",
      'Ordered from catalogues each year',
      'I save some seed and buy the rest',
      'I save most of my own seed and grow my own transplants') },

  // ---- perennial ----
  { id: 'p1', dim: 'perennial', text: 'How many productive fruit or nut trees and shrubs are established on your land?',
    help: 'Hardy apples and pears, sour cherries, plums, saskatoons, haskap, sea buckthorn, currants, raspberries.',
    options: opts('None', 'A handful — one to five', 'Six to twenty', 'Over twenty, in a planned layout') },
  { id: 'p2', dim: 'perennial', text: "What's growing under and around them?",
    options: opts(
      'Lawn, or nothing planted',
      'Mulch rings',
      'Some companion planting — comfrey, herbs, nitrogen fixers',
      'Full guilds — layers stacked, largely self-maintaining') },
  { id: 'p3', dim: 'perennial', text: 'What perennial vegetables, herbs, or edible natives do you have?',
    options: opts(
      'None',
      'Rhubarb and a couple of herbs',
      'A dedicated perennial bed — asparagus, sorrel, sunchokes, walking onions',
      'Perennial food integrated across the whole site, including wild and native species') },

  // ---- animals ----
  { id: 'n1', dim: 'animals', text: 'What livestock do you keep?',
    options: opts(
      'None',
      'Laying hens or rabbits',
      'Poultry plus one other — goats, sheep, pigs, bees',
      'A working mix including a ruminant, breeding on site') },
  { id: 'n2', dim: 'animals', text: 'If the feed store closed tomorrow, how long could you feed your animals?',
    options: opts(
      'Not applicable, or a few days',
      'A few weeks of stored feed',
      'A season — or I grow part of my own feed',
      'Largely self-sufficient — pasture, hay and forage produced here') },
  { id: 'n3', dim: 'animals', text: 'Beyond livestock, what other protein does your land provide?',
    options: opts(
      'None',
      'Eggs only',
      'Eggs plus hunting, fishing, or foraging',
      'Several reliable sources — meat, eggs, fish, legumes grown for storage') },

  // ---- soil ----
  { id: 's1', dim: 'soil', text: 'How do you handle organic waste?',
    options: opts(
      'It goes in the garbage',
      'A compost pile, roughly managed',
      'An active system producing finished compost I actually use',
      'Closed loop — compost, manure, blackwater treatment. Nothing leaves') },
  { id: 's2', dim: 'soil', text: 'Where does your fertility come from?',
    options: opts(
      'Bagged fertilizer from town',
      'Bought compost and manure',
      'Mostly on-site — my own compost and animal manure',
      'Entirely on-site — nitrogen fixers, chop-and-drop, animal integration, biochar') },
  { id: 's3', dim: 'soil', text: 'Do you know what your soil is actually doing?',
    options: opts(
      'Never tested or assessed it',
      'I have a general sense of the texture and drainage',
      "I've had it tested",
      'I test periodically and track organic matter over time') },

  // ---- storage ----
  { id: 'g1', dim: 'storage', text: 'How do you store the harvest?',
    help: 'A chest freezer is a fragile store — one long outage from being a box of spoiled meat.',
    options: opts(
      'Fridge and freezer only',
      'Freezer plus a cool basement corner',
      'A proper root cellar or cold room',
      'Root cellar plus canning, drying, fermenting and curing in regular use') },
  { id: 'g2', dim: 'storage', text: "How much of your household's food for the year is in storage right now?",
    options: opts('Less than two weeks', 'About a month', 'Three to six months', 'Most of a year') },
  { id: 'g3', dim: 'storage', text: 'How much of what\'s stored did you produce yourself?',
    options: opts('None — it\'s all bought', 'A small share', 'Roughly half', 'Most of it') },

  // ---- heat ----
  { id: 'h1', dim: 'heat', text: 'Gas and power go out in January. How do you heat your home?',
    help: "Unlike Calgary, there's no chinook coming. A −35 °C stretch here stays.",
    options: opts(
      "I couldn't",
      'A fireplace or space heater, short term',
      'Woodstove, with wood I buy',
      'Woodstove or masonry heater, with wood I harvest and season myself') },
  { id: 'h2', dim: 'heat', text: 'What electricity can you produce or store?',
    options: opts(
      'None — fully grid dependent',
      'A gas generator',
      'Solar with battery backup for essentials',
      'A system that runs the whole household independent of the grid') },
  { id: 'h3', dim: 'heat', text: 'How well does your building hold the heat it\'s given?',
    options: opts(
      'Older build, drafty, no upgrades',
      'Some upgrades — windows or attic insulation',
      'Well sealed and insulated throughout',
      'Passive-solar oriented, high-performance envelope, thermal mass') },

  // ---- people ----
  { id: 'd1', dim: 'people', text: 'Has your property ever been through a whole-site design process?',
    options: opts(
      'No — things got put where there was room',
      "I've sketched some ideas",
      "I have a plan I'm working through",
      'A professional design mapping zones, sectors, water and access') },
  { id: 'd2', dim: 'people', text: 'How many neighbours could you call on for real help — tools, labour, a place to stay?',
    options: opts('None', 'One or two', 'Three to five', 'A real network — we already share tools, labour and harvests') },
  { id: 'd3', dim: 'people', type: 'multi', max: 3, dim_: 'people',
    text: 'Which of these could you do without looking it up?',
    help: 'Pick everything that applies. Three or more scores full marks.',
    options: [
      { label: 'Prune a fruit tree' },
      { label: 'Pressure can low-acid food safely' },
      { label: 'Butcher a chicken' },
      { label: "Split and stack a season's wood" },
      { label: 'Fix your own plumbing or wiring' },
      { label: 'Save true-to-type seed' },
      { label: 'Read a contour and set a grade' }
    ] }
];

export const ARCHETYPES = [
  { max: 20,  name: 'Bare Ground',
    line: 'Everything you eat and drink arrives by truck. That also means enormous upside — the first moves are the cheapest ones you will ever make.' },
  { max: 40,  name: 'Dabbler',
    line: "You've made a start. The pieces aren't connected yet, so each one still costs you time instead of saving it." },
  { max: 60,  name: 'Grower',
    line: 'A real producing site. The gap now is between growing food and keeping it through a bad year.' },
  { max: 80,  name: 'Homesteader',
    line: "Serious capability. You're past the obvious wins — what's left is design work and closing loops." },
  { max: 101, name: 'Regenerative Site',
    line: 'Rare. Your land produces surplus and rebuilds itself. Worth protecting properly, and worth teaching from.' }
];

// Plain-language fixes, keyed by dimension, used in the results and the report.
export const REMEDIES = {
  water:     'Storage and earthworks come first, before anything else gets planted. Note that a dugout for irrigation or livestock may need registration under the Water Act, and county setbacks vary — worth checking before you dig.',
  annuals:   'Season extension buys you six to eight weeks at both ends. A high tunnel is the highest-return structure on most Edmonton-area sites.',
  perennial: 'This is the one that punishes waiting. Hardy stock — haskap, saskatoon, sour cherry, apples on Ottawa 3 — planted this spring is producing while everything else is still a plan.',
  animals:   'Feed autonomy matters more than headcount. Pasture and stored forage turn animals from a liability into a fertility engine.',
  soil:      'Every dollar of imported fertility is a subscription. Nitrogen fixers, chop-and-drop and animal integration cancel it.',
  storage:   'A root cellar is cheap compared to what it protects, and it works when the power does not.',
  heat:      'Envelope first, then a heat source that runs without the grid. In this climate that ordering saves the most money.',
  people:    'Sequencing is the whole game: water, access, structures, then plants. Planting first is the most common and most expensive mistake we see.'
};

export function score(answers) {
  const dims = {};
  for (const key of Object.keys(DIMENSIONS)) dims[key] = { raw: 0, count: 0 };

  for (const q of QUESTIONS) {
    if (q.type === 'profile') continue;
    const a = answers[q.id];
    let pts = 0;
    if (q.type === 'multi') pts = Math.min((a || []).length, q.max);
    else pts = typeof a === 'number' ? a : 0;
    dims[q.dim].raw += pts;
    dims[q.dim].count += 3;
  }

  let num = 0, den = 0;
  for (const [key, d] of Object.entries(dims)) {
    d.pct = d.count ? Math.round((d.raw / d.count) * 100) : 0;
    d.name = DIMENSIONS[key].name;
    num += d.pct * DIMENSIONS[key].weight;
    den += DIMENSIONS[key].weight;
  }
  const total = Math.round(num / den);

  const ranked = Object.entries(dims).sort((a, b) => a[1].pct - b[1].pct);
  const limiting = ranked[0];
  const alsoLow = ranked[1] && ranked[1][1].pct - limiting[1].pct <= 10 ? ranked[1] : null;

  // Nonlinear on purpose: a site at half capability doesn't last half as long.
  // Buffer compounds — storage only helps if there's production behind it.
  const base = (dims.storage.pct * 1.1 + dims.water.pct * 0.4 +
                dims.annuals.pct * 0.35 + dims.animals.pct * 0.35) / 2.2;
  const days = (base * base) / 50;

  return {
    total,
    dims,
    archetype: ARCHETYPES.find(a => total < a.max),
    limiting: { key: limiting[0], ...limiting[1] },
    alsoLow: alsoLow ? { key: alsoLow[0], ...alsoLow[1] } : null,
    gaps: ranked.slice(0, 3).map(([k, v]) => ({ key: k, name: v.name, pct: v.pct, fix: REMEDIES[k] })),
    daysLow: Math.max(3, Math.round(days * 0.8)),
    daysHigh: Math.max(7, Math.round(days * 1.25))
  };
}
