require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mockPlaceCreate = jest.fn();
const mockPlaceFindById = jest.fn();
const mockUploadStream = jest.fn();

jest.mock('../../src/models/mongodb/Place', () => ({
  CATEGORIES: ['playa', 'sitio_cultural', 'hotel', 'restaurante', 'evento', 'entretenimiento', 'naturaleza'],
  create: (...args) => mockPlaceCreate(...args),
  findById: (...args) => mockPlaceFindById(...args),
}));

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: (...args) => mockUploadStream(...args),
    },
  },
}));

const app = require('../../src/app');

describe('Fotos de lugares con Cloudinary', () => {
  let token;

  beforeAll(() => {
    process.env.JWT_SECRET = 'place-photos-test-secret';
    token = jwt.sign({ id: 'admin-1', role: 'administrador' }, process.env.JWT_SECRET);
  });

  beforeEach(() => {
    mockUploadStream.mockImplementation((options, callback) => ({
      end: () =>
        callback(null, {
          secure_url: `https://cloudinary.test/photo-${mockUploadStream.mock.calls.length}`,
        }),
    }));
  });

  afterEach(() => jest.clearAllMocks());

  it('sube fotos al crear un lugar y persiste las secure_url', async () => {
    mockPlaceCreate.mockImplementation(async (place) => place);

    const response = await request(app)
      .post('/api/v1/local/places')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'Cascada de prueba')
      .field('category', 'naturaleza')
      .field('lat', '20.27')
      .field('lng', '-97.96')
      .attach('images', Buffer.from('fake-jpg'), { filename: 'cascada.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(201);
    expect(mockPlaceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        images: ['https://cloudinary.test/photo-1'],
        location: { type: 'Point', coordinates: [-97.96, 20.27] },
      })
    );
    expect(mockUploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'travexperience-places',
        transformation: [
          { width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
        ],
      }),
      expect.any(Function)
    );
  });

  it('agrega las URL seguras a un lugar existente', async () => {
    const place = { isActive: true, images: ['https://existing.test/image.jpg'], save: jest.fn() };
    mockPlaceFindById.mockResolvedValue(place);

    const response = await request(app)
      .post('/api/v1/local/places/507f1f77bcf86cd799439011/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('images', Buffer.from('fake-png'), { filename: 'otra.png', contentType: 'image/png' });

    expect(response.status).toBe(200);
    expect(place.images).toEqual([
      'https://existing.test/image.jpg',
      'https://cloudinary.test/photo-1',
    ]);
    expect(place.save).toHaveBeenCalled();
  });

  it('permite crear lugares JSON sin fotos', async () => {
    mockPlaceCreate.mockImplementation(async (place) => place);

    const response = await request(app)
      .post('/api/v1/local/places')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lugar sin foto', category: 'naturaleza', lat: 20.27, lng: -97.96 });

    expect(response.status).toBe(201);
    expect(mockPlaceCreate).toHaveBeenCalledWith(expect.objectContaining({ images: [] }));
    expect(mockUploadStream).not.toHaveBeenCalled();
  });
});
