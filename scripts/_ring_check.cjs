// Ring-winding acceptance check for stage 07.
//
// The point of invariant 8 is that the CONSUMER agrees the rings are wound
// correctly, not that a human inspected coordinate order. The consumer is
// d3-geo, so this loads the actual vendored bundle the frontend ships and
// asks it, via d3.geoArea, whether every feature reads as a small patch of
// the globe rather than the whole sphere minus that patch.
//
// Usage: node _ring_check.cjs <d3-array.min.js> <d3-geo.min.js> <geojson...>

const fs = require("fs");

function loadUmd(file, requireMap) {
  const code = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  const fn = new Function("module", "exports", "require", code);
  fn(module, module.exports, (name) => {
    if (Object.prototype.hasOwnProperty.call(requireMap, name)) {
      return requireMap[name];
    }
    throw new Error(`_ring_check: cannot resolve ${name}`);
  });
  return module.exports;
}

const [, , arrayPath, geoPath, ...geojsonPaths] = process.argv;
const d3Array = loadUmd(arrayPath, {});
const d3Geo = loadUmd(geoPath, { "d3-array": d3Array });

const results = [];
for (const path of geojsonPaths) {
  const fc = JSON.parse(fs.readFileSync(path, "utf8"));
  for (const feature of fc.features) {
    const area = d3Geo.geoArea(feature);
    results.push({
      file: path,
      geoid: (feature.properties && (feature.properties.geoid || feature.properties.state)) || null,
      area,
    });
  }
}

process.stdout.write(JSON.stringify(results));
