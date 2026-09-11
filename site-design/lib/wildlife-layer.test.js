import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedSpeciesAt,
  speciesAtRiskFlagged,
  wildlifeTriggers,
  wildlifeFlags,
  locationPrecisionFromRecord,
  distanceToBboxM,
  confidenceForRangeSource,
  observationCacheFresh,
  expectedCacheFresh,
  OBS_CACHE_TTL_MS,
  EXPECTED_CACHE_TTL_MS,
  isUngulate,
  isPredator,
  isPollinator,
  buildWildlifeLayer,
} from './wildlife-layer.js';

const parkland = { latitude: 53.55, longitude: -113.5 };
const bbox = { west: -113.51, south: 53.54, east: -113.49, north: 53.56 };

test('expectedSpeciesAt lists FWMIS deer in parkland and not sage-grouse', () => {
  const expected = expectedSpeciesAt(parkland);
  const names = expected.map((s) => s.scientific_name);
  assert.ok(names.includes('Odocoileus virginianus'));
  assert.ok(!names.includes('Centrocercus urophasianus'));
  const deer = expected.find((s) => s.scientific_name === 'Odocoileus virginianus');
  assert.equal(deer.range_source, 'FWMIS');
  assert.equal(deer.confidence, 'high');
  assert.equal(deer.location_precision, 'range_polygon_only');
});

test('COSEWIC caribou is expected only in the boreal and is flagged SAR', () => {
  const north = expectedSpeciesAt({ latitude: 56.2, longitude: -115 });
  const south = expectedSpeciesAt(parkland);
  assert.ok(north.some((s) => s.scientific_name === 'Rangifer tarandus caribou'));
  assert.ok(!south.some((s) => s.scientific_name === 'Rangifer tarandus caribou'));
  const sar = speciesAtRiskFlagged(north, []);
  assert.ok(sar.includes('Rangifer tarandus caribou'));
  const caribou = north.find((s) => s.scientific_name.includes('Rangifer'));
  assert.equal(caribou.location_precision, 'obscured');
  assert.equal(caribou.confidence, 'high');
});

test('wildlifeTriggers: ungulates → fence, predators → camera, pollinators → habitat', () => {
  const t = wildlifeTriggers({
    expected: [
      { scientific_name: 'Odocoileus virginianus', common_name: 'White-tailed Deer' },
      { scientific_name: 'Canis latrans', common_name: 'Coyote' },
      { scientific_name: 'Bombus huntii', common_name: "Hunt's Bumble Bee" },
    ],
    observations: [],
    sar: [],
  });
  assert.equal(t.ungulates, true);
  assert.equal(t.predators, true);
  assert.equal(t.pollinators, true);
  assert.ok(t.packages.includes('deer_wildlife_fence'));
  assert.ok(t.packages.includes('wildlife_camera_monitoring'));
  assert.ok(t.packages.includes('pollinator_habitat'));
});

test('wetland species only pulls riparian package when water is nearby', () => {
  const dry = wildlifeTriggers({
    expected: [{ scientific_name: 'Castor canadensis', common_name: 'Beaver' }],
    observations: [],
    sar: [],
  });
  const wet = wildlifeTriggers({
    expected: [{ scientific_name: 'Castor canadensis', common_name: 'Beaver' }],
    observations: [],
    sar: [],
    wetlands: { present: true },
  });
  assert.equal(dry.riparian_package, false);
  assert.equal(wet.riparian_package, true);
  assert.ok(wet.packages.includes('riparian_wetland_restoration'));
});

test('SAR flag language stays at range/habitat, never a pinpoint', () => {
  const flags = wildlifeFlags({ species_at_risk: true }, ['Rangifer tarandus caribou']);
  assert.equal(flags[0].code, 'species_at_risk');
  assert.match(flags[0].message, /range\/habitat/i);
  assert.match(flags[0].message, /not pinpointed/i);
  assert.doesNotMatch(flags[0].message, /at this coordinate|exact nest|den site/i);
});

test('obscured geoprivacy never claims exact location', () => {
  assert.equal(locationPrecisionFromRecord({ geoprivacy: 'obscured' }), 'obscured');
  assert.equal(locationPrecisionFromRecord({ issues: ['GEOPRIVACY'] }), 'generalized');
  assert.equal(locationPrecisionFromRecord({ uncertaintyM: 15000 }), 'generalized');
  assert.equal(locationPrecisionFromRecord({}), 'exact');
});

test('distanceToBboxM is 0 inside the parcel and positive outside', () => {
  assert.equal(distanceToBboxM(53.55, -113.5, bbox), 0);
  assert.ok(distanceToBboxM(53.7, -113.5, bbox) > 1000);
});

test('range-source confidence: curated high, IUCN/eBird low', () => {
  assert.equal(confidenceForRangeSource('ACIMS'), 'high');
  assert.equal(confidenceForRangeSource('FWMIS'), 'high');
  assert.equal(confidenceForRangeSource('COSEWIC'), 'high');
  assert.equal(confidenceForRangeSource('IUCN_REDLIST_FALLBACK'), 'low');
  assert.equal(confidenceForRangeSource('EBIRD_STATUS_TRENDS'), 'low');
});

test('observation cache expires quarterly; expected cache lasts a year', () => {
  const now = Date.parse('2026-09-11');
  assert.equal(observationCacheFresh({ _cached_at: now - OBS_CACHE_TTL_MS + 1000 }, now), true);
  assert.equal(observationCacheFresh({ _cached_at: now - OBS_CACHE_TTL_MS - 1000 }, now), false);
  assert.equal(expectedCacheFresh({ _cached_at: now - EXPECTED_CACHE_TTL_MS + 1000 }, now), true);
  assert.equal(expectedCacheFresh({ _cached_at: now - EXPECTED_CACHE_TTL_MS - 1000 }, now), false);
});

test('name matchers cover deer, coyote, bumble bee', () => {
  assert.equal(isUngulate('Odocoileus virginianus'), true);
  assert.equal(isPredator('Canis latrans'), true);
  assert.equal(isPollinator('Bombus huntii'), true);
});

test('buildWildlifeLayer keeps expected vs observations separate and respects obscured coords', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('gbif')) {
      return {
        ok: true,
        json: async () => ({
          results: [{
            species: 'Puma concolor',
            vernacularName: 'Cougar',
            eventDate: '2025-06-01',
            decimalLatitude: 53.55,
            decimalLongitude: -113.5,
            issues: ['GEOPRIVACY'],
            class: 'Mammalia',
          }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        results: [{
          taxon: { name: 'Odocoileus virginianus', preferred_common_name: 'White-tailed Deer', iconic_taxon_id: 1, threatened: false },
          observed_on: '2025-08-02',
          quality_grade: 'research',
          geoprivacy: 'obscured',
          location: '53.551,-113.501',
        }],
      }),
    };
  };
  const layer = await buildWildlifeLayer({
    bbox,
    centre: parkland,
    skipCache: true,
    fetchImpl,
  });
  assert.ok(layer.expected_species.length > 0);
  assert.ok(layer.observations_nearby.some((o) => o.source === 'INATURALIST'));
  assert.ok(layer.observations_nearby.some((o) => o.source === 'GBIF'));
  const obscured = layer.observations_nearby.find((o) => o.scientific_name === 'Odocoileus virginianus');
  assert.equal(obscured.location_precision, 'obscured');
  assert.equal(obscured.distance_from_parcel_m, null);
  assert.ok(layer.triggers.packages.includes('deer_wildlife_fence'));
  assert.ok(layer.triggers.packages.includes('wildlife_camera_monitoring'));
});
