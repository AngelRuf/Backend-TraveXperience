require('dotenv').config();
const request = require('supertest');
const app = require('../../src/app');

describe('GET /api/v1/weather/forecast', () => {
  afterEach(() => jest.restoreAllMocks());

  it('devuelve periodos transformados sin llamar a un servicio externo real', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ['2026-11-18'],
          temperature_2m_min: [12],
          temperature_2m_max: [22],
          weathercode: [2],
          precipitation_probability_max: [20],
        },
      }),
    });

    const response = await request(app)
      .get('/api/v1/weather/forecast')
      .query({ lat: 61.12, lng: 13.98 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.forecast).toEqual([
      {
        date: '2026-11-18',
        tempMin: 12,
        tempMax: 22,
        description: 'Parcialmente nublado',
        rainProbability: 20,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rechaza coordenadas ausentes o inválidas sin consultar el servicio', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const missing = await request(app).get('/api/v1/weather/forecast');
    const invalid = await request(app)
      .get('/api/v1/weather/forecast')
      .query({ lat: 95, lng: -97 });

    expect(missing.status).toBe(422);
    expect(invalid.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
