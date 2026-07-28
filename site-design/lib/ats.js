/**
 * Alberta Township System (ATS) legal land description from lat/lng.
 * Uses mathematical conversion based on the Dominion Land Survey grid.
 *
 * Alberta meridians: W4 (110°W), W5 (114°W), W6 (118°W)
 * Township lines are every 6 miles north from the 49th parallel.
 * Range lines are every 6 miles west from each meridian.
 *
 * Returns: quarter-section, section, township, range, meridian
 */

/**
 * Convert lat/lng to ATS legal land description.
 * @param {{ latitude: number, longitude: number }} coords
 * @returns {{ description: string, quarter: string, section: number, township: number, range: number, meridian: string, lsd: string|null }|null}
 */
export function latLngToAts(coords) {
  const { latitude, longitude } = coords;

  // Alberta bounds check
  if (latitude < 48.9 || latitude > 60.1 || longitude < -120.1 || longitude > -109.9) {
    return null; // Outside Alberta
  }

  // Determine meridian
  let meridian, baseLng;
  if (longitude < -110) {
    if (longitude < -114) {
      if (longitude < -118) {
        meridian = 'W6';
        baseLng = -118;
      } else {
        meridian = 'W5';
        baseLng = -114;
      }
    } else {
      meridian = 'W4';
      baseLng = -110;
    }
  } else {
    meridian = 'W4';
    baseLng = -110;
  }

  // Township: 6 miles per township, starting at 49°N
  const milesNorth = (latitude - 49) * 69.055; // Approx miles per degree lat
  const township = Math.floor(milesNorth / 6) + 1;

  // Range: 6 miles per range, increasing west from meridian
  const milesWest = Math.abs(longitude - baseLng) * (69.055 * Math.cos((latitude * Math.PI) / 180));
  const range = Math.floor(milesWest / 6) + 1;

  // Section: 1-mile grid within a township (6x6 sections)
  // Township origin is SE corner. Sections numbered:
  //   31 32 33 34 35 36
  //   30 29 28 27 26 25
  //   ... (snake pattern)
  //   7  8  9  10 11 12
  //   6  5  4  3  2  1
  const fracMileNorth = (milesNorth % 6);
  const fracMileWest = (milesWest % 6);

  const colFromWest = Math.floor(fracMileWest); // 0-5
  const rowFromSouth = Math.floor(fracMileNorth); // 0-5

  // Snake numbering
  let section;
  if (rowFromSouth % 2 === 0) {
    // Even row (0,2,4) = sections go east to west
    section = rowFromSouth * 6 + (6 - colFromWest);
  } else {
    // Odd row (1,3,5) = sections go west to east
    section = rowFromSouth * 6 + colFromWest + 1;
  }

  // Quarter section
  const fracSecNorth = fracMileNorth - rowFromSouth;
  const fracSecWest = fracMileWest - colFromWest;

  let quarter;
  if (fracSecNorth >= 0.5) {
    quarter = fracSecWest >= 0.5 ? 'NW' : 'NE';
  } else {
    quarter = fracSecWest >= 0.5 ? 'SW' : 'SE';
  }

  const description = `${quarter} ${section}-${township}-${range}-${meridian}`;

  return {
    description,
    quarter,
    section,
    township,
    range,
    meridian,
    lsd: null, // LSD requires finer granularity data
    accuracy_note: 'Quarter-section (160-acre) resolution. LSD requires ATS polygon dataset.',
  };
}

/**
 * Format ATS for display in the report.
 */
export function formatAts(ats) {
  if (!ats) return 'Outside Alberta';
  return `Near ${ats.description}`;
}