const { pickCommonsCandidate, truncateDescription, stripHtml, createEnricher } = require('../../scripts/enrichPlaces');
const { createHttpClient } = require('../../scripts/lib/httpClient');

const place = { name: 'Cascada de Tenango', location: { type: 'Point', coordinates: [-98.17, 20.27] } };

const page = (over = {}) => ({
  title: 'File:Cascada de Tenango 1.jpg',
  index: 1,
  coordinates: [{ lat: 20.2701, lon: -98.1701 }],
  imageinfo: [{
    mime: 'image/jpeg', width: 2000, url: 'https://upload.wikimedia.org/o.jpg', thumburl: 'https://upload.wikimedia.org/t.jpg',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
    extmetadata: { Artist: { value: '<a href="x">Juan &amp; Ana</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
  }],
  ...over,
});

describe('pickCommonsCandidate', () => {
  it('elige la foto relacionada con licencia libre y limpia el autor', () => {
    const r = pickCommonsCandidate(place, { query: { pages: { 1: page() } } });
    expect(r.imageUrl).toBe('https://upload.wikimedia.org/t.jpg');
    expect(r.credit).toEqual({ author: 'Juan & Ana', license: 'CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg' });
  });
  it('descarta svg/gif, imágenes pequeñas y licencias no libres', () => {
    const bad = (mut) => { const p = page(); Object.assign(p.imageinfo[0], mut); return p; };
    const pages = {
      1: bad({ mime: 'image/svg+xml' }), 2: bad({ mime: 'image/gif' }), 3: bad({ width: 300 }),
      4: bad({ extmetadata: { LicenseShortName: { value: 'Non-free fair use' } } }),
    };
    expect(pickCommonsCandidate(place, { query: { pages } })).toBeNull();
  });
  it('descarta fotos lejanas sin relación con el nombre', () => {
    const p = page({ title: 'File:Calle.jpg', coordinates: [{ lat: 20.28, lon: -98.18 }] });
    expect(pickCommonsCandidate(place, { query: { pages: { 1: p } } })).toBeNull();
  });
  it('devuelve null si Commons no regresa resultados', () => {
    expect(pickCommonsCandidate(place, {})).toBeNull();
  });
});

describe('textos', () => {
  it('truncateDescription respeta 800 caracteres con la fuente', () => {
    const out = truncateDescription('Frase larga de prueba. '.repeat(100));
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out.endsWith('(Fuente: Wikipedia)')).toBe(true);
  });
  it('stripHtml', () => expect(stripHtml('<b>a</b> &amp; b')).toBe('a & b'));
});

describe('createHttpClient', () => {
  const resp = (status, body = {}, headers = {}) => ({ ok: status < 400, status, json: async () => body, headers: { get: (k) => headers[k] } });

  it('reintenta ante 429/500 con backoff y respeta Retry-After', async () => {
    const sleeps = [];
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(resp(429, {}, { 'retry-after': '3' }))
      .mockResolvedValueOnce(resp(503))
      .mockResolvedValueOnce(resp(200, { ok: 1 }));
    const http = createHttpClient({ fetchImpl, sleepImpl: async (ms) => sleeps.push(ms), userAgent: 'test/1.0' });
    await expect(http.requestJson('https://x.org/a')).resolves.toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toContain(3000);
    expect(sleeps).toContain(4000);
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toBe('test/1.0');
  });
  it('no reintenta errores 4xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(resp(404));
    const http = createHttpClient({ fetchImpl, sleepImpl: async () => {} });
    await expect(http.requestJson('https://x.org/a')).rejects.toThrow('HTTP 404');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('espera >= 1 s entre peticiones', async () => {
    const waits = [];
    const http = createHttpClient({ fetchImpl: async () => resp(200), sleepImpl: async (ms) => waits.push(ms) });
    await http.requestJson('https://x.org/1');
    await http.requestJson('https://x.org/2');
    expect(waits.some((w) => w > 900)).toBe(true);
  });
});

describe('findWikipediaDescription', () => {
  it('usa coordenadas si el título se parece y cae a título exacto', async () => {
    const extract = 'La cascada de Tenango es un salto de agua ubicado en la Sierra Norte de Puebla, México.';
    const http = { requestJson: jest.fn()
      .mockResolvedValueOnce({ query: { pages: { 9: { title: 'Cascada de Tenango', index: 1, extract } } } }) };
    const r = await createEnricher(http, { radius: 500 }).findWikipediaDescription(place);
    expect(r).toContain('Sierra Norte');
    expect(r).toContain('(Fuente: Wikipedia)');
    expect(http.requestJson).toHaveBeenCalledTimes(1);

    const http2 = { requestJson: jest.fn()
      .mockResolvedValueOnce({ query: { pages: { 1: { title: 'Otra cosa', extract } } } })
      .mockResolvedValueOnce({ query: { pages: { '-1': { missing: '' } } } }) };
    expect(await createEnricher(http2, { radius: 500 }).findWikipediaDescription(place)).toBeNull();
  });
});
