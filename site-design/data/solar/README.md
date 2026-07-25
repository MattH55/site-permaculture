# NRCan solar resource (municipality)

Direct downloads from Natural Resources Canada — no login:

| File | Content |
|------|---------|
| `municip_kWh.csv` | Mean daily global insolation (kWh/m²) by municipality, month + Annual, six PV orientations |
| `municip_MJ.csv` | Same series in MJ/m² |

Source FTP:
https://ftp.maps.canada.ca/pub/nrcan_rncan/Solar-energy_Energie-solaire/photovoltaic_canada_photovoltaique/

Used by `lib/solar.js` for site solar incidence and rough PV viability (nearest municipality row, south latitude-tilt primary).

**Caveat:** Interpolated from 1974–1993 station data (ANUSPLIN). Fine for household feasibility; not for recent climate-trend analysis. Parcel shading and roof geometry are not modelled.
