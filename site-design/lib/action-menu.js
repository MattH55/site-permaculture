/**
 * Client-facing "Build your plan" menu — one harmonized list of interventions.
 *
 * UX principles:
 *  - Site analysis delivers free value first; this menu is the conversion step.
 *  - Select / unselect; defaults are conservative (no outbuilding selected).
 *  - Well only when no nearby on-parcel well is detected.
 *  - Pond / swales only when the parcel lacks surface water signals.
 *  - A few planting + shelterbelt options, not every package in the catalog.
 */

/**
 * @param {object} ctx — assembled report signals
 * @returns {{ items: object[], water_on_site: boolean, well_on_site: boolean, summary: string }}
 */
export function buildActionMenu(ctx = {}) {
  const packages = ctx.service_packages?.packages || [];
  const byId = Object.fromEntries(packages.map((p) => [p.id, p]));
  const quoteItems = ctx.service_quote?.items || [];
  const quoteByService = Object.fromEntries(
    quoteItems.map((i) => [i.service || i.serviceId, i])
  );
  const planting = ctx.planting_plan || ctx.recommended_plantings;
  const topPlants = (planting?.recommended || planting?.rows || []).slice(0, 6);
  const waterOnSite = detectWaterOnSite(ctx);
  const wellOnSite = detectWellOnSite(ctx);

  const items = [];

  // ── Shelterbelts (always offer 1–2 if wind/parcel makes sense) ──
  const sb = byId.shelterbelt_package;
  const sbQuote = quoteByService.shelterbelt;
  items.push(
    menuItem({
      id: 'shelterbelt_main',
      category: 'shelter',
      label: 'Wind & snow shelterbelt',
      blurb:
        sb?.blurb ||
        'Multi-row belt upwind of house and yard — wind reduction and snow management.',
      reason:
        sb?.reason ||
        'Rural Alberta parcels almost always benefit from a windward belt for microclimate and snow control.',
      price: priceFromPkg(sb) || priceFromQuote(sbQuote),
      default_selected: true,
      group: 'planting_shelter',
      size: sbQuote?.size ?? sb?.size,
      unit: sbQuote?.unit || 'm',
      related_package_id: 'shelterbelt_package',
    })
  );
  items.push(
    menuItem({
      id: 'shelterbelt_living',
      category: 'shelter',
      label: 'Living snow fence / edge belt',
      blurb:
        'Shorter dense edge planting along the most exposed boundary — lower cost alternative or phase-1 shelter.',
      reason: 'A staged option if you want protection before a full multi-row belt.',
      price: scalePrice(priceFromPkg(sb) || priceFromQuote(sbQuote), 0.45, 'Living snow fence (planning)'),
      default_selected: false,
      group: 'planting_shelter',
      related_package_id: 'shelterbelt_package',
    })
  );

  // ── Planting options (a few, not the full catalog) ──
  const ff = byId.food_forest_package;
  const ffQuote = quoteByService.foodforest;
  const plantNames = topPlants
    .map((p) => p.common_name)
    .filter(Boolean)
    .slice(0, 4);
  items.push(
    menuItem({
      id: 'food_forest',
      category: 'food',
      label: 'Food forest guilds',
      blurb:
        ff?.blurb ||
        'Layered perennial polyculture for kitchen and market yield once soil-building is underway.',
      reason:
        ff?.reason ||
        (plantNames.length
          ? `Top fits for this site include ${plantNames.join(', ')}.`
          : 'Parcel climate supports staged perennial food production.'),
      price: priceFromPkg(ff) || priceFromQuote(ffQuote) || fixedBand(12_000, 'Food forest starter (planning)'),
      default_selected: !!ff || topPlants.length > 0,
      group: 'planting_shelter',
      size: ffQuote?.size ?? ff?.size,
      unit: ffQuote?.unit || 'guilds',
      related_package_id: 'food_forest_package',
      plant_highlights: plantNames,
    })
  );

  const soil = byId.soil_carbon_package;
  items.push(
    menuItem({
      id: 'soil_building',
      category: 'food',
      label: 'Soil-building plantings',
      blurb:
        soil?.blurb ||
        'Cover crops, compost systems, and nitrogen-fixers to raise organic matter before heavier production.',
      reason:
        soil?.reason ||
        'Soil structure and biology usually limit first-year food yield on rural sites.',
      price: priceFromPkg(soil) || fixedBand(8_500, 'Soil-building starter package'),
      default_selected: !!soil && (soil.priority ?? 9) <= 3,
      group: 'planting_shelter',
      related_package_id: 'soil_carbon_package',
    })
  );

  const z1 = byId.zone1_garden_package;
  items.push(
    menuItem({
      id: 'zone1_garden',
      category: 'food',
      label: 'Zone 1 kitchen garden',
      blurb:
        z1?.blurb ||
        'Herb spiral, keyhole beds, and intensive daily-use layout near the house.',
      reason: z1?.reason || 'Quick wins for household food while longer-term plantings establish.',
      price: priceFromPkg(z1) || fixedBand(3_200, 'Zone 1 intensive beds'),
      default_selected: false,
      group: 'planting_shelter',
      related_package_id: 'zone1_garden_package',
    })
  );

  // ── Well (only if no on-site well detected) ──
  if (!wellOnSite) {
    const well = byId.well_drilling;
    const wellDepth = ctx.predicted_well_depth || ctx.well;
    items.push(
      menuItem({
        id: 'groundwater_well',
        category: 'water',
        label: 'Groundwater well',
        blurb:
          well?.blurb ||
          'Licensed drill to a hydrology-based completion depth from nearby well records.',
        reason:
          well?.reason ||
          (wellDepth?.estimated_depth_m != null
            ? `No well detected on/near the parcel. Planning completion ~${wellDepth.estimated_depth_m} m from nearby records.`
            : 'No well detected on/near the parcel — secure water supply for household and livestock.'),
        price: priceFromPkg(well) || wellFallbackPrice(wellDepth),
        default_selected: true,
        group: 'water',
        related_package_id: 'well_drilling',
        site_facts: well?.site_facts || {
          estimated_depth_m: wellDepth?.estimated_depth_m ?? null,
        },
      })
    );
  }

  // ── Pond / swales only when surface water is absent ──
  if (!waterOnSite) {
    const swale = byId.swale_package;
    const swaleQuote = quoteByService.swale;
    items.push(
      menuItem({
        id: 'contour_swales',
        category: 'water',
        label: 'Contour swales',
        blurb:
          swale?.blurb ||
          'On-contour water harvest so rainfall soaks in instead of leaving the parcel.',
        reason:
          swale?.reason ||
          'No mapped surface water on the parcel — swales hold and infiltrate rainfall where slope allows.',
        price: priceFromPkg(swale) || priceFromQuote(swaleQuote) || fixedBand(9_500, 'Swale package (planning)'),
        default_selected: !!swale || (ctx.terrain?.slope_percent != null && ctx.terrain.slope_percent >= 2),
        group: 'water',
        size: swaleQuote?.size ?? swale?.size,
        unit: swaleQuote?.unit || 'm',
        related_package_id: 'swale_package',
      })
    );

    const pond = byId.pond_package;
    const pondQuote = quoteByService.pond;
    items.push(
      menuItem({
        id: 'pond_storage',
        category: 'water',
        label: 'Pond / water storage',
        blurb:
          pond?.blurb ||
          'Valley-floor storage for drought buffer, wildlife, and microclimate.',
        reason:
          pond?.reason ||
          'No reliable surface water on the parcel — storage improves drought resilience and habitat.',
        price: priceFromPkg(pond) || priceFromQuote(pondQuote) || fixedBand(28_000, 'Pond / dam (planning)'),
        default_selected: !!pond,
        group: 'water',
        size: pondQuote?.size ?? pond?.size,
        unit: pondQuote?.unit || 'm³',
        related_package_id: 'pond_package',
      })
    );
  }

  // ── Outbuilding: available, never default-selected ──
  const garage = byId.off_grid_garage;
  items.push(
    menuItem({
      id: 'off_grid_garage',
      category: 'shelter',
      label: 'Off-grid garage / workshop',
      blurb:
        garage?.blurb ||
        'Turnkey insulated garage / workshop shell — power-ready for solar and well gear.',
      reason:
        'Optional outbuilding package — not included by default. Select only if you want a workshop/garage in scope.',
      price: priceFromPkg(garage) || fixedBand(250_000, 'Off-grid garage package (fixed offer)'),
      default_selected: false,
      group: 'optional',
      related_package_id: 'off_grid_garage',
      optional: true,
    })
  );

  // Optional: best-fit solar as extra (off by default)
  const solar = packages.find((p) => p.category === 'energy' && p.featured);
  if (solar) {
    items.push(
      menuItem({
        id: solar.id,
        category: 'energy',
        label: solar.label || 'Solar + storage package',
        blurb: solar.blurb,
        reason: solar.reason || 'Optional energy package matched to site insolation.',
        price: priceFromPkg(solar),
        default_selected: false,
        group: 'optional',
        related_package_id: solar.id,
        optional: true,
        site_facts: solar.site_facts,
      })
    );
  }

  const selectedDefault = items.filter((i) => i.default_selected);
  const subtotal = selectedDefault.reduce((s, i) => s + (i.price?.amount_cad || 0), 0);

  return {
    version: 1,
    items,
    water_on_site: waterOnSite,
    well_on_site: wellOnSite,
    default_selected_ids: selectedDefault.map((i) => i.id),
    default_subtotal_cad: Math.round(subtotal),
    summary: buildMenuSummary(items, waterOnSite, wellOnSite),
    disclaimer:
      'Planning-level options only. Select what you want priced; final scope is confirmed on a site walk before any firm quote.',
    inquiry_email: 'info@expandingedge.ca',
  };
}

export function detectWaterOnSite(ctx = {}) {
  const w = ctx.wetlands || {};
  const sw = ctx.small_water || {};
  const sum = sw.summary || {};
  const near = ctx.proximity?.nearest_water_source || ctx.proximity_context?.nearest_water_source;
  if (w.has_wetland_on_site) return true;
  if (sum.has_confirmed_water || sum.has_any_water && sum.nearest_water_distance_m === 0) return true;
  if (sum.nearest_water_distance_m != null && sum.nearest_water_distance_m < 40) return true;
  if (near?.distance_m != null && near.distance_m < 40) return true;
  if ((sw.open_water_features || []).some((f) => f.on_parcel || f.confidence === 'high')) return true;
  return false;
}

export function detectWellOnSite(ctx = {}) {
  const well = ctx.predicted_well_depth || ctx.well || {};
  const nearby = well.nearby_wells || [];
  // Treat a recorded well within ~80 m of the parcel centre as likely on/near site
  for (const w of nearby) {
    const d =
      w.distance_m != null
        ? w.distance_m
        : w.distance_km != null
          ? w.distance_km * 1000
          : null;
    if (d != null && d < 80) return true;
  }
  return false;
}

function menuItem(o) {
  return {
    id: o.id,
    category: o.category,
    label: o.label,
    blurb: o.blurb,
    reason: o.reason,
    price: o.price || null,
    default_selected: !!o.default_selected,
    group: o.group || 'other',
    size: o.size ?? null,
    unit: o.unit ?? null,
    related_package_id: o.related_package_id || null,
    plant_highlights: o.plant_highlights || null,
    site_facts: o.site_facts || null,
    optional: !!o.optional,
  };
}

function priceFromPkg(p) {
  if (!p?.price?.amount_cad) return null;
  return {
    kind: p.price.kind || 'package',
    amount_cad: p.price.amount_cad,
    currency: 'CAD',
    label: p.price.label || p.label,
    range_low_cad: p.price.range_low_cad ?? Math.round(p.price.amount_cad * 0.9),
    range_high_cad: p.price.range_high_cad ?? Math.round(p.price.amount_cad * 1.2),
    field_days: p.price.field_days ?? null,
    line_items: p.price.line_items || null,
    travel_cost_cad: p.price.travel_cost_cad ?? null,
    materials_cost_cad: p.price.materials_cost_cad ?? null,
  };
}

function priceFromQuote(item) {
  if (!item?.subtotal) return null;
  return {
    kind: 'field_estimate',
    amount_cad: item.subtotal,
    currency: 'CAD',
    label: item.serviceName,
    range_low_cad: item.rangeLow ?? Math.round(item.subtotal * 0.9),
    range_high_cad: item.rangeHigh ?? Math.round(item.subtotal * 1.25),
    field_days: item.fieldDays ?? null,
    line_items: (item.lineItems || []).map((l) => ({
      label: l.label,
      cost_cad: l.cost,
    })),
    travel_cost_cad: item.travelCost ?? null,
    materials_cost_cad: item.materialsCost ?? null,
    materials_pct: item.materialsPct ?? null,
  };
}

function fixedBand(amount, label) {
  return {
    kind: 'package',
    amount_cad: amount,
    currency: 'CAD',
    label,
    range_low_cad: Math.round(amount * 0.9),
    range_high_cad: Math.round(amount * 1.15),
  };
}

function scalePrice(price, factor, label) {
  if (!price?.amount_cad) return fixedBand(Math.round(5000 * factor), label);
  const mid = Math.round(price.amount_cad * factor);
  return {
    ...price,
    amount_cad: mid,
    label: label || price.label,
    range_low_cad: Math.round((price.range_low_cad || mid) * factor),
    range_high_cad: Math.round((price.range_high_cad || mid) * factor),
    travel_cost_cad:
      price.travel_cost_cad != null ? Math.round(price.travel_cost_cad * factor) : null,
    materials_cost_cad:
      price.materials_cost_cad != null ? Math.round(price.materials_cost_cad * factor) : null,
  };
}

function wellFallbackPrice(well) {
  const depthM = well?.estimated_depth_m ?? 40;
  const depthFt = depthM * 3.28084;
  const mid = Math.max(11_500, Math.round(92 * depthFt + 4600));
  return {
    kind: 'well_planning',
    amount_cad: mid,
    currency: 'CAD',
    label: `Well drill planning (~${Math.round(depthFt)} ft)`,
    range_low_cad: Math.round(mid * 0.88),
    range_high_cad: Math.round(mid * 1.22),
  };
}

function buildMenuSummary(items, waterOnSite, wellOnSite) {
  const n = items.filter((i) => i.default_selected).length;
  const bits = [`${n} recommended options pre-selected`];
  if (wellOnSite) bits.push('existing well likely on/near site — well package omitted');
  else bits.push('well offered (none detected on parcel)');
  if (waterOnSite) bits.push('surface water present — pond/swale packages omitted');
  else bits.push('no surface water on parcel — pond & swales offered');
  bits.push('outbuilding optional, off by default');
  return bits.join('. ') + '.';
}
