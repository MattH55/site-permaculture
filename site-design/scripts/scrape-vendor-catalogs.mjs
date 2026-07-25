/**
 * Scrape plant product catalogs from vendors listed in vendors.json
 * and write:
 *   data/crops/vendor-listings.json  — raw products
 *   data/crops/vendor-catalog.json   — EcoCrop-style crops for planting scorer
 *
 * Usage: node scripts/scrape-vendor-catalogs.mjs
 *        node scripts/scrape-vendor-catalogs.mjs --vendors ttseeds,treetime
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_LISTINGS = path.join(ROOT, 'data', 'crops', 'vendor-listings.json');
const OUT_CATALOG = path.join(ROOT, 'data', 'crops', 'vendor-catalog.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 ExpandingEdgeCatalog/1.0 (+https://www.expandingedge.ca; plant catalog research)';

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--vendors='))?.split('=')[1];
const onlySet = onlyArg
  ? new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

/** Plant vendors only (skip fertilizer / amazon / google). */
const SCRAPERS = {
  ttseeds: scrapeShopify.bind(null, {
    vendor_id: 'ttseeds',
    name: 'T&T Seeds',
    base: 'https://www.ttseeds.com',
    kinds: ['seeds', 'saplings'],
  }),
  westcoastseeds: scrapeShopify.bind(null, {
    vendor_id: 'westcoastseeds',
    name: 'West Coast Seeds',
    base: 'https://www.westcoastseeds.com',
    kinds: ['seeds'],
  }),
  wildaboutflowers: scrapeShopify.bind(null, {
    vendor_id: 'wildaboutflowers',
    name: 'Wild About Flowers',
    base: 'https://www.wildaboutflowers.ca',
    kinds: ['seeds', 'saplings'],
    prefer_native: true,
  }),
  oscseeds: scrapeOsc,
  earlyseed: scrapeEarlys,
  treetime: scrapeTreeTime,
  // Best-effort / may be blocked:
  veseys: scrapeShopify.bind(null, {
    vendor_id: 'veseys',
    name: 'Veseys',
    base: 'https://www.veseys.com',
    kinds: ['seeds', 'saplings'],
  }),
  richters: scrapeRichters,
  prairieoriginals: scrapePrairieOriginals,
};

const NON_PLANT_RE =
  /\b(gift\s*card|giftcard|printed catalogue|marketing materials|potting mix|soil mix|fertilizer|fertiliser|inoculant|mycorrhizae|garden gloves|pruner|watering wand|hose end|seed tray|humidity dome|plant label|bucket|water clarifier|subscription|membership|row cover|twine|hoof nipper|beef jerky|pony saddle|flower box holder|hardware|sprayer|nozzle|tarp|fence post|bolt|screw|battery|motor oil|grease|air filter|oil filter|drive belt|tire|lamp|bulb holder|light fixture|pet food|dog food|cat food|bird seed|wild bird|chicken feed|livestock|bridle|halter)\b/i;

/** Early's is a full farm store — only keep plant/seed-like titles. */
const PLANT_HINT_RE =
  /\b(seed|seeds|plant|plants|seedling|tree|shrub|herb|flower|vegetable|fruit|berry|garlic|bulb|perennial|annual|biennial|tomato|pepper|lettuce|kale|carrot|beet|onion|bean|pea|corn|squash|cucumber|melon|radish|spinach|broccoli|cabbage|cauliflower|potato|asparagus|rhubarb|strawberry|raspberry|blueberry|currant|saskatoon|haskap|apple|plum|cherry|rose|lilac|spruce|pine|willow|poplar|maple|birch|oak|grass|clover|vetch|alfalfa|cover crop|wildflower|native|lupin|echinacea|yarrow|sunflower|zinnia|marigold|petunia|pansy|dahlia|lily|tulip|daffodil|hosta|daylily|peony|mint|basil|thyme|oregano|sage|parsley|cilantro|dill|chive)\b/i;

async function main() {
  const results = {
    scraped_at: new Date().toISOString(),
    disclaimer:
      'Product catalogs scraped for Expanding Edge planting planning. Names and stock change; verify on vendor site before ordering. Not affiliated with vendors.',
    vendors: {},
    products: [],
  };

  for (const [id, fn] of Object.entries(SCRAPERS)) {
    if (onlySet && !onlySet.has(id)) continue;
    process.stdout.write(`\n=== ${id} ===\n`);
    try {
      const { products, meta } = await fn();
      const plants = products.filter((p) => isPlantProduct(p));
      results.vendors[id] = {
        ok: true,
        count_raw: products.length,
        count_plants: plants.length,
        ...meta,
      };
      results.products.push(...plants);
      console.log(`  → ${plants.length} plants (from ${products.length} raw)`);
    } catch (e) {
      results.vendors[id] = { ok: false, error: e.message };
      console.log(`  FAIL: ${e.message}`);
    }
  }

  // Dedupe product listings by vendor+name
  const seen = new Set();
  results.products = results.products.filter((p) => {
    const k = `${p.vendor_id}::${normKey(p.title)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  fs.mkdirSync(path.dirname(OUT_LISTINGS), { recursive: true });
  fs.writeFileSync(OUT_LISTINGS, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.products.length} products → ${OUT_LISTINGS}`);

  const catalog = buildCropCatalog(results.products);
  fs.writeFileSync(OUT_CATALOG, JSON.stringify(catalog, null, 2));
  console.log(
    `Wrote ${catalog.crops.length} crop records → ${OUT_CATALOG}`
  );
  console.log('Vendor summary:', results.vendors);
}

/* ---------- Shopify ---------- */

async function scrapeShopify(cfg) {
  const products = [];
  let page = 1;
  while (page <= 40) {
    const url = `${cfg.base}/products.json?limit=250&page=${page}`;
    const j = await getJson(url);
    const batch = j.products || [];
    if (!batch.length) break;
    for (const p of batch) {
      products.push({
        vendor_id: cfg.vendor_id,
        vendor_name: cfg.name,
        title: decodeEntities(p.title),
        handle: p.handle,
        url: `${cfg.base}/products/${p.handle}`,
        product_type: p.product_type || '',
        tags: Array.isArray(p.tags)
          ? p.tags
          : String(p.tags || '')
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
        vendor_field: p.vendor || '',
        body_excerpt: stripHtml(p.body_html || '').slice(0, 280),
        kinds: cfg.kinds,
        alberta_native: !!(cfg.prefer_native || /native/i.test(String(p.tags))),
        scraped_from: 'shopify_products_json',
      });
    }
    console.log(`  page ${page}: ${batch.length}`);
    if (batch.length < 250) break;
    page++;
    await sleep(200);
  }
  return {
    products,
    meta: { method: 'shopify_products_json', base: cfg.base, pages: page },
  };
}

/* ---------- OSC WooCommerce ---------- */

async function scrapeOsc() {
  const products = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 50) {
    const url = `https://www.oscseeds.com/wp-json/wc/store/v1/products?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`OSC HTTP ${res.status}`);
    totalPages = Number(res.headers.get('x-wp-totalpages') || totalPages);
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const p of batch) {
      const cats = (p.categories || []).map((c) =>
        decodeEntities(c.name || c.slug || '')
      );
      products.push({
        vendor_id: 'oscseeds',
        vendor_name: 'OSC Seeds',
        title: decodeEntities(p.name || ''),
        handle: p.slug,
        url: p.permalink || `https://www.oscseeds.com/product/${p.slug}/`,
        product_type: cats[0] || '',
        tags: cats,
        body_excerpt: stripHtml(p.short_description || p.description || '').slice(
          0,
          280
        ),
        kinds: ['seeds'],
        scraped_from: 'woocommerce_store_api',
      });
    }
    console.log(`  page ${page}/${totalPages}: ${batch.length}`);
    page++;
    await sleep(250);
  }
  return {
    products,
    meta: { method: 'woocommerce_store_api', total_pages: totalPages },
  };
}

/* ---------- Early's (sitemap slugs) ---------- */

async function scrapeEarlys() {
  const sm = await getText('https://www.earlysgarden.com/sitemap.xml');
  const locs = [...sm.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((m) =>
    m[1].trim()
  );
  const productUrls = locs.filter((u) => /\/shop-online\/p-\d+/i.test(u));
  const products = [];
  for (const url of productUrls) {
    const slug = url.split('/').pop() || '';
    // p-576-leeks-large-musselburg
    const m = slug.match(/^p-\d+-(.+)$/i);
    if (!m) continue;
    const title = slugToTitle(m[1]);
    products.push({
      vendor_id: 'earlyseed',
      vendor_name: "Early's Farm & Garden",
      title,
      handle: slug,
      url,
      product_type: inferTypeFromTitle(title),
      tags: [],
      kinds: ['seeds'],
      scraped_from: 'sitemap_slug',
    });
  }
  console.log(`  sitemap products: ${products.length}`);
  return {
    products,
    meta: { method: 'sitemap_slug', sitemap_urls: productUrls.length },
  };
}

/* ---------- TreeTime plant finder ---------- */

async function scrapeTreeTime() {
  const html = await getText('https://treetime.ca/plant-finder.php');
  const chunks = html.split(/data-search-item-position="/).slice(1);
  const products = [];

  for (const chunk of chunks) {
    const block = chunk.slice(0, 4000);
    // Prefer productTitle anchor; fall back to img alt
    const titleLink = block.match(
      /class="productTitle"[^>]*href="([^"]+)"[^>]*>\s*([^<]{2,120}?)\s*</i
    );
    const titleLink2 = block.match(
      /href="([^"]+)"[^>]*class="productTitle"[^>]*>\s*([^<]{2,120}?)\s*</i
    );
    const imgAlt = block.match(/<img[^>]+alt="([^"]{2,120})"/i);
    const hrefRaw =
      titleLink?.[1] ||
      titleLink2?.[1] ||
      block.match(/href="((?:https:\/\/treetime\.ca)?\/productsList\.php\?[^"]+)"/i)?.[1];
    const title = decodeEntities(
      (titleLink?.[2] || titleLink2?.[2] || imgAlt?.[1] || '').trim()
    );
    if (!title || /^zone$/i.test(title) || /^more$/i.test(title) || title.length < 2)
      continue;
    let href = (hrefRaw || '').replace(/&amp;/g, '&');
    if (href.startsWith('/')) href = `https://treetime.ca${href}`;
    if (!href) href = `https://treetime.ca/plant-finder.php`;

    const zone =
      block.match(
        /col-(?:4 col-)?lg-1 text-center[^>]*>\s*(\d[ab]?)\s*</i
      )?.[1]?.toLowerCase() ||
      block.match(/>\s*(\d[ab]?)\s*</)?.[1]?.toLowerCase() ||
      null;
    const moistureBlock = block.match(
      /col-(?:4 col-)?lg-2 text-center[^>]*>\s*([\s\S]*?)\s*<\/div>/i
    )?.[1];
    const moisture = moistureBlock
      ? moistureBlock
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : null;
    const light =
      block.match(/>(full sun|partial shade|full shade|shade|sun)</i)?.[1] ||
      null;

    const pcid = href.match(/pcid=(\d+)/)?.[1];
    products.push({
      vendor_id: 'treetime',
      vendor_name: 'TreeTime.ca',
      title,
      handle: pcid ? `pcid-${pcid}` : slugify(title),
      url: href,
      product_type: 'Woody plant / seedling',
      tags: [zone && `zone ${zone}`, moisture, light].filter(Boolean),
      hardiness_min: zone || null,
      moisture: moisture || null,
      light: light || null,
      kinds: ['saplings'],
      scraped_from: 'plant_finder_html',
    });
  }

  // Plant-finder only for crop catalog (alternate_names are SEO aliases, often noisy)
  console.log(`  plant-finder products: ${products.length}`);
  return {
    products,
    meta: { method: 'plant_finder_html', finder_rows: chunks.length },
  };
}

/* ---------- Richters (best effort) ---------- */

async function scrapeRichters() {
  // New site often blocks bots; try common collection JSON and HTML category pages
  const urls = [
    'https://www.richters.com/products.json?limit=250&page=1',
    'https://www.richters.com/collections/all/products.json?limit=50',
  ];
  for (const url of urls) {
    try {
      const j = await getJson(url);
      if (j.products?.length) {
        return scrapeShopifyFromProducts(j.products, {
          vendor_id: 'richters',
          name: 'Richters Herbs',
          base: 'https://www.richters.com',
          kinds: ['seeds', 'saplings'],
        });
      }
    } catch {
      /* try next */
    }
  }
  throw new Error('Richters blocked or no public product JSON (403/HTML challenge)');
}

function scrapeShopifyFromProducts(batch, cfg) {
  const products = batch.map((p) => ({
    vendor_id: cfg.vendor_id,
    vendor_name: cfg.name,
    title: decodeEntities(p.title),
    handle: p.handle,
    url: `${cfg.base}/products/${p.handle}`,
    product_type: p.product_type || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    kinds: cfg.kinds,
    scraped_from: 'shopify_products_json',
  }));
  return { products, meta: { method: 'shopify_products_json', partial: true } };
}

/* ---------- Prairie Originals ---------- */

async function scrapePrairieOriginals() {
  // Small native-seed nursery — try Shopify-like and HTML sitemap
  try {
    return await scrapeShopify({
      vendor_id: 'prairieoriginals',
      name: 'Prairie Originals',
      base: 'https://www.prairieoriginals.com',
      kinds: ['seeds'],
      prefer_native: true,
    });
  } catch {
    /* fall through */
  }
  const sm = await getText('https://www.prairieoriginals.com/sitemap.xml');
  const locs = [...sm.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((m) =>
    m[1].trim()
  );
  const productUrls = locs.filter(
    (u) => /\/product|\/shop|\/seeds?\//i.test(u) || /prairieoriginals\.com\/[^/]+\/?$/i.test(u)
  );
  const products = [];
  for (const url of productUrls) {
    const slug = url.replace(/\/$/, '').split('/').pop();
    if (!slug || /sitemap|cart|account|policy/i.test(slug)) continue;
    products.push({
      vendor_id: 'prairieoriginals',
      vendor_name: 'Prairie Originals',
      title: slugToTitle(slug),
      handle: slug,
      url,
      product_type: 'Native seed',
      tags: ['native'],
      kinds: ['seeds'],
      alberta_native: true,
      scraped_from: 'sitemap',
    });
  }
  if (!products.length) throw new Error('No Prairie Originals products found');
  return { products, meta: { method: 'sitemap', count: products.length } };
}

/* ---------- Normalize to crop catalog ---------- */

function buildCropCatalog(products) {
  // Prefer non-alias TreeTime entries; merge vendors onto crop records
  const byKey = new Map();

  for (const p of products) {
    if (p.is_alias) continue; // aliases only help search; skip as primary crop rows
    if (!isPlantProduct(p)) continue;

    const cropId = cropIdFromTitle(p.title);
    if (!cropId || cropId.length < 2) continue;

    const inferred = inferCropTraits(p);
    const existing = byKey.get(cropId);

    const supplier = {
      vendor_id: p.vendor_id,
      name: p.vendor_name,
      url: p.url,
      kind: (p.kinds && p.kinds[0]) || 'seeds',
      product_hint: p.title,
      region: null,
    };

    if (!existing) {
      byKey.set(cropId, {
        id: cropId,
        common_name: cleanCommonName(p.title),
        scientific_name: extractScientific(p) || '',
        category: inferred.category,
        guild_layer: inferred.guild_layer,
        hardiness_min: p.hardiness_min || inferred.hardiness_min,
        hardiness_max: inferred.hardiness_max,
        frost_free_min_days: inferred.frost_free_min_days,
        precip_min_mm: inferred.precip_min_mm,
        precip_max_mm: inferred.precip_max_mm,
        ph_min: 5.5,
        ph_max: 7.8,
        textures: inferred.textures,
        drainage: inferred.drainage,
        chinook_sensitive: inferred.chinook_sensitive,
        alberta_native: !!(p.alberta_native || inferred.alberta_native),
        notes: `Listed by ${p.vendor_name}. ${p.body_excerpt || ''}`.trim().slice(0, 300),
        source_vendors: [p.vendor_id],
        product_urls: [p.url],
        suppliers: {
          seeds: p.kinds?.includes('seeds') ? [supplier] : [],
          saplings: p.kinds?.includes('saplings') ? [supplier] : [],
        },
        search_terms: {
          seeds: `${cleanCommonName(p.title)} seed`,
          saplings: `${cleanCommonName(p.title)} plant seedling`,
        },
        _vendor_product: true,
      });
    } else {
      if (!existing.source_vendors.includes(p.vendor_id)) {
        existing.source_vendors.push(p.vendor_id);
      }
      if (p.url && !existing.product_urls.includes(p.url)) {
        existing.product_urls.push(p.url);
      }
      if (p.hardiness_min && zoneRank(p.hardiness_min) < zoneRank(existing.hardiness_min || '9a')) {
        existing.hardiness_min = p.hardiness_min;
      }
      if (p.alberta_native) existing.alberta_native = true;
      if (p.kinds?.includes('seeds')) {
        existing.suppliers.seeds = [
          ...(existing.suppliers.seeds || []),
          supplier,
        ].slice(0, 6);
      }
      if (p.kinds?.includes('saplings')) {
        existing.suppliers.saplings = [
          ...(existing.suppliers.saplings || []),
          supplier,
        ].slice(0, 6);
      }
      // Prefer real scientific name if found later
      if (!existing.scientific_name && extractScientific(p)) {
        existing.scientific_name = extractScientific(p);
      }
    }
  }

  const crops = [...byKey.values()].sort((a, b) =>
    a.common_name.localeCompare(b.common_name)
  );

  return {
    source:
      'Vendor-scraped plant varieties for Expanding Edge planting plans (merged product catalogs)',
    scraped_at: new Date().toISOString(),
    crop_count: crops.length,
    notes:
      'Hardiness and site traits are inferred when vendors do not publish full EcoCrop fields. Prefer TreeTime zone data when present. Always verify cultivar hardiness before planting.',
    crops,
  };
}

function inferCropTraits(p) {
  const blob = `${p.title} ${p.product_type} ${(p.tags || []).join(' ')}`.toLowerCase();
  let category = 'annual';
  let guild_layer = 'herbaceous';
  let hardiness_min = '3a';
  let hardiness_max = '7a';
  let frost_free_min_days = 100;
  let chinook_sensitive = false;
  let alberta_native = /native|prairie|wildflower/i.test(blob);
  let precip_min_mm = 300;
  let precip_max_mm = 1000;
  let textures = ['sandy_loam', 'loam', 'silt_loam', 'clay_loam'];
  let drainage = ['well', 'moderately_well'];

  if (
    /tree|poplar|spruce|pine|fir|larch|willow|maple|ash|oak|birch|linden|elm|hackberry|aspen|apple|plum|cherry|pear|apricot|walnut|hazel/i.test(
      blob
    )
  ) {
    category = 'tree';
    guild_layer = /apple|plum|cherry|pear|apricot|fruit/i.test(blob)
      ? 'canopy'
      : 'canopy';
    hardiness_min = p.hardiness_min || '2b';
    frost_free_min_days = 90;
  } else if (
    /shrub|berry|saskatoon|haskap|currant|gooseberry|elder|lilac|rose|viburnum|dogwood|serviceberry|blueberry|raspberry|honeyberry|cranberry|buffaloberry|chokecherry|willow/i.test(
      blob
    )
  ) {
    category = 'shrub';
    guild_layer = 'shrub';
    hardiness_min = p.hardiness_min || '2a';
    frost_free_min_days = 90;
  } else if (
    /perennial|echinacea|yarrow|lupin|iris|daylily|hosta|peony|asparagus|rhubarb|herb|mint|thyme|oregano|sage|lavender|echinacea|medicinal/i.test(
      blob
    )
  ) {
    category = 'perennial';
    guild_layer = 'herbaceous';
    hardiness_min = p.hardiness_min || '3a';
    frost_free_min_days = 100;
  } else if (/cover\s*crop|clover|vetch|rye|buckwheat|alfalfa|field pea/i.test(blob)) {
    category = 'cover_crop';
    guild_layer = 'groundcover';
    hardiness_min = '2a';
    frost_free_min_days = 70;
  } else if (/garlic|bulb|tulip|daffodil|crocus|allium/i.test(blob)) {
    category = 'perennial';
    guild_layer = 'herbaceous';
    hardiness_min = '3a';
    frost_free_min_days = 90;
  } else if (
    /tomato|pepper|cucumber|squash|bean|pea|lettuce|kale|carrot|beet|onion|corn|melon|basil|annual|vegetable|flower seed/i.test(
      blob
    )
  ) {
    category = 'annual';
    guild_layer = 'herbaceous';
    hardiness_min = '3a';
    frost_free_min_days = 110;
    chinook_sensitive = /tomato|pepper|melon|cucumber/i.test(blob);
  }

  if (p.vendor_id === 'treetime') {
    category = category === 'annual' ? 'tree' : category;
    guild_layer = category === 'shrub' ? 'shrub' : 'canopy';
    hardiness_min = p.hardiness_min || hardiness_min;
  }
  if (p.vendor_id === 'wildaboutflowers' || p.vendor_id === 'prairieoriginals') {
    alberta_native = true;
    category = category === 'annual' ? 'perennial' : category;
  }
  if (p.hardiness_min) hardiness_min = p.hardiness_min;

  return {
    category,
    guild_layer,
    hardiness_min,
    hardiness_max,
    frost_free_min_days,
    chinook_sensitive,
    alberta_native,
    precip_min_mm,
    precip_max_mm,
    textures,
    drainage,
  };
}

/* ---------- helpers ---------- */

function isPlantProduct(p) {
  const title = p.title || '';
  const blob = `${title} ${p.product_type} ${(p.tags || []).join(' ')}`;
  if (NON_PLANT_RE.test(blob)) return false;
  if (/^organic seaweed liquid/i.test(title)) return false;
  if (/preorder.*catalogue/i.test(title)) return false;
  // Navigation / non-product junk
  if (/\.(php|html?|aspx)\b/i.test(title)) return false;
  if (/^(about|contact|cart|login|search|home|index|blog|faq)\b/i.test(title))
    return false;
  if (/aimers\s+/i.test(title) && /mixture|mix\b/i.test(title)) {
    // keep seed mixes
  }
  // accessories without plant names
  if (/accessories|plant protection|seed starting supplies/i.test(p.product_type || '')) {
    if (!/seed|plant|tree|shrub|herb|flower|vegetable|fruit|garlic|bulb/i.test(title)) {
      return false;
    }
  }
  // Full farm-store catalogs need a positive plant hint
  if (p.vendor_id === 'earlyseed' || p.scraped_from === 'sitemap_slug') {
    if (!PLANT_HINT_RE.test(blob)) return false;
  }
  // Reject pure numeric/hardware titles
  if (/^\d/.test(title) && !PLANT_HINT_RE.test(title)) return false;
  return true;
}

function cropIdFromTitle(title) {
  let t = cleanCommonName(title)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(seeds?|plants?|seedlings?|bulbs?|bare root|pkt|pack|organic|hybrid|f1)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  // keep reasonable length
  const parts = t.split('-').filter(Boolean);
  if (parts.length > 6) t = parts.slice(0, 6).join('-');
  return t.slice(0, 64);
}

function cleanCommonName(title) {
  let t = decodeEntities(title)
    .replace(/\[preorder\]/gi, '')
    .replace(/\s*[-–|]\s*\d+\s*(gram|g|kg|pack|pk|bulb|\/pk).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // "Achillea borealis - Yarrow" → prefer common name after dash when latin first
  const latinFirst = t.match(
    /^[A-Z][a-z]+(?:\s+(?:x\s+)?[a-z]+)+\s*[-–:]\s*(.+)$/
  );
  if (latinFirst && latinFirst[1].length > 2) {
    t = latinFirst[1].trim();
  }
  // Strip trailing seed SKU numbers "Alsike Clover Seeds 6680"
  t = t.replace(/\s+seeds?\s+\d{3,}$/i, '').replace(/\s+\d{4,}$/g, '').trim();
  return t;
}

function extractScientific(p) {
  // "Achillea borealis - Yarrow" style
  const m = (p.title || '').match(
    /^([A-Z][a-z]+(?:\s+(?:x\s+)?[a-z]+(?:\s+var\.\s+[a-z]+)?)+)\s*[-–:]/
  );
  if (m) return m[1];
  const body = p.body_excerpt || '';
  const m2 = body.match(/\b([A-Z][a-z]+\s+[a-z]{3,}(?:\s+var\.\s+[a-z]+)?)\b/);
  return m2?.[1] || '';
}

function slugToTitle(slug) {
  return decodeURIComponent(slug)
    .replace(/-quot-/gi, '"')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function inferTypeFromTitle(title) {
  if (/tree|spruce|pine|maple/i.test(title)) return 'Tree';
  if (/seed/i.test(title)) return 'Seed';
  if (/fertilizer/i.test(title)) return 'Fertilizer';
  return 'Garden product';
}

function zoneRank(z) {
  const order = [
    '1a','1b','2a','2b','3a','3b','4a','4b','5a','5b','6a','6b','7a','7b','8a','8b','9a',
  ];
  const i = order.indexOf(String(z).toLowerCase());
  return i < 0 ? 99 : i;
}

function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    )
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#8243;/g, '"');
}

async function getJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  if (text.trim().startsWith('<')) {
    throw new Error(`HTML challenge instead of JSON: ${url}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url} (${ct})`);
  }
}

async function getText(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,*/*' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
