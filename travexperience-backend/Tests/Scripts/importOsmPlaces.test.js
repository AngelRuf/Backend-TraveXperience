const { mapCategory, elementToCandidate, findDuplicate, buildOverpassQuery } = require('../../scripts/importOsmPlaces');
const Place = require('../../src/models/mongodb/Place');

describe('importOsmPlaces', () => {
  it('mapea a categorías existentes de Place', () => {
    const cats = [
      mapCategory({ waterway: 'waterfall' }), mapCategory({ tourism: 'museum' }), mapCategory({ historic: 'monument' }),
      mapCategory({ tourism: 'viewpoint' }), mapCategory({ leisure: 'park' }), mapCategory({ tourism: 'attraction' }),
      mapCategory({ amenity: 'place_of_worship', religion: 'christian' }),
    ];
    cats.forEach((c) => expect(Place.CATEGORIES).toContain(c));
    expect(mapCategory({ historic: 'wayside_cross' })).toBeNull();
    expect(mapCategory({ shop: 'bakery' })).toBeNull();
  });

  it('convierte un nodo a Place con GeoJSON [lng, lat] y source osm', () => {
    const c = elementToCandidate({ type: 'node', id: 42, lat: 20.2745, lon: -97.955, tags: { name: 'Mirador Cerro', tourism: 'viewpoint' } });
    expect(c.location.coordinates).toEqual([-97.955, 20.2745]);
    expect(c).toMatchObject({ source: 'osm', osmId: 'node/42', municipality: 'Xicotepec', category: 'naturaleza', images: [] });
  });

  it('usa center para ways y descarta elementos sin nombre', () => {
    expect(elementToCandidate({ type: 'way', id: 1, center: { lat: 20.17, lon: -98.05 }, tags: { name: 'Parroquia', amenity: 'place_of_worship' } }).municipality).toBe('Huauchinango');
    expect(elementToCandidate({ type: 'node', id: 2, lat: 20.2, lon: -98, tags: { tourism: 'viewpoint' } })).toBeNull();
  });

  it('detecta duplicados por nombre normalizado y distancia < 80 m', () => {
    const cand = elementToCandidate({ type: 'node', id: 7, lat: 20.2727, lon: -97.9618, tags: { name: 'Parroquia de San Juan', historic: 'church' } });
    const near = { name: 'parroquia de san juán', location: { coordinates: [-97.96185, 20.27272] } };
    const far = { name: 'Parroquia de San Juan', location: { coordinates: [-97.9618, 20.2827] } };
    const other = { name: 'Mercado', location: { coordinates: [-97.9618, 20.2727] } };
    expect(findDuplicate(cand, [near]).duplicate).toBe(true);
    expect(findDuplicate(cand, [other]).duplicate).toBe(false);
    const f = findDuplicate(cand, [far]);
    expect(f.duplicate).toBe(false); // ~1.1 km: fuera de ambas reglas
    expect(findDuplicate(cand, [{ ...far, location: { coordinates: [-97.9618, 20.2777] } }])).toMatchObject({ duplicate: true, review: true });
    expect(findDuplicate(cand, [{ name: 'x', osmId: 'node/7', location: { coordinates: [0, 0] } }]).duplicate).toBe(true);
  });

  it('la consulta Overpass incluye las categorías pedidas', () => {
    const q = buildOverpassQuery({ lat: 20.27, lng: -97.96, radius: 5000 });
    ['viewpoint|attraction|museum', '"historic"', 'waterfall', '"park"', 'place_of_worship', 'out center tags'].forEach((s) => expect(q).toContain(s));
  });
});
