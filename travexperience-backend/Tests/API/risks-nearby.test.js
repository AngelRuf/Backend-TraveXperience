require('dotenv').config();
const request = require('supertest');
const mockRiskFind = jest.fn();

jest.mock('../../src/models/mongodb/RiskAlert', () => ({
  find: (...args) => mockRiskFind(...args),
}));

const app = require('../../src/app');

describe('GET /api/v1/risks/nearby', () => {
  afterEach(() => jest.clearAllMocks());

  it('devuelve alertas activas cercanas con sus campos públicos', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-11-17T00:00:00.000Z');
    mockRiskFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'risk-1',
          title: 'Crecida de río',
          severity: 'alto',
          recommendation: 'Evita cruzar el cauce.',
          municipality: 'Xicotepec',
          location: { type: 'Point', coordinates: [-97.96, 20.27] },
          source: 'Protección Civil',
          updatedAt,
          expiresAt,
        },
      ]),
    });

    const response = await request(app)
      .get('/api/v1/risks/nearby')
      .query({ lat: 20.27, lng: -97.96, radius: 10000, municipality: 'Xicotepec' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        risks: [
          {
            id: 'risk-1',
            severity: 'alto',
            recommendation: 'Evita cruzar el cauce.',
            location: { type: 'Point', coordinates: [-97.96, 20.27] },
            source: 'Protección Civil',
            updatedAt: updatedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
        ],
      },
    });
    expect(mockRiskFind).toHaveBeenCalledWith(
      expect.objectContaining({
        municipality: /^Xicotepec$/i,
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [-97.96, 20.27] },
            $maxDistance: 10000,
          },
        },
      })
    );
  });

  it('valida coordenadas y exige coordenadas o municipio', async () => {
    const missing = await request(app).get('/api/v1/risks/nearby');
    const invalid = await request(app)
      .get('/api/v1/risks/nearby')
      .query({ lat: 91, lng: -97 });

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(422);
    expect(mockRiskFind).not.toHaveBeenCalled();
  });
});
