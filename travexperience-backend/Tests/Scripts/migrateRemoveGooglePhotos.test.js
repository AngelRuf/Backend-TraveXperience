const { computeChanges, buildMatcher } = require('../../scripts/migrateRemoveGooglePhotos');

const isBad = buildMatcher(false);

describe('migrateRemoveGooglePhotos.computeChanges', () => {
  it('quita URLs de Google (string y objeto) y conserva las propias', () => {
    const doc = {
      images: [
        'https://api.x.com/api/v1/maps/photo?ref=abc',
        'https://maps.googleapis.com/maps/api/place/photo?photo_reference=z',
        { url: 'https://maps.googleapis.com/x', secure_url: 'https://maps.googleapis.com/x' },
        '/uploads/places/foto.jpg',
        { url: 'https://upload.wikimedia.org/a.jpg' },
      ],
      photoReference: 'abc',
    };
    const r = computeChanges(doc, isBad);
    expect(r.set.images).toEqual(['/uploads/places/foto.jpg', { url: 'https://upload.wikimedia.org/a.jpg' }]);
    expect(r.unset).toEqual({ photoReference: '' });
    expect(r.hasImageAfter).toBe(true);
  });

  it('reporta documentos que quedan sin imagen y limpia mainImage de Google', () => {
    const r = computeChanges(
      { images: ['https://h/api/v1/maps/photo?ref=1'], mainImage: 'https://h/api/v1/maps/photo?ref=1', photo_reference: 'x' },
      isBad
    );
    expect(r.set.images).toEqual([]);
    expect(r.unset).toEqual({ mainImage: '', photo_reference: '' });
    expect(r.hasImageAfter).toBe(false);
  });

  it('es idempotente: un documento ya limpio no cambia', () => {
    const r = computeChanges({ images: ['/uploads/places/a.jpg'] }, isBad);
    expect(r.changed).toBe(false);
  });

  it('placehold.co solo se quita con --include-placeholders', () => {
    const doc = { images: ['https://placehold.co/1200x800/x.png?text=a'] };
    expect(computeChanges(doc, buildMatcher(false)).changed).toBe(false);
    expect(computeChanges(doc, buildMatcher(true)).set.images).toEqual([]);
  });
});
