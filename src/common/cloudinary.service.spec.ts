const uploadStreamMock = jest.fn();
const configMock = jest.fn();

jest.mock('cloudinary', () => ({
  v2: {
    config: (...args: unknown[]) => configMock(...args),
    uploader: { upload_stream: (...args: unknown[]) => uploadStreamMock(...args) },
  },
}));

import { CloudinaryService } from './cloudinary.service';

describe('CloudinaryService', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; jest.clearAllMocks(); });

  it('sem CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET: lança erro explícito ao instanciar', () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    expect(() => new CloudinaryService()).toThrow(/CLOUDINARY_CLOUD_NAME/);
  });

  it('com as 3 env vars: configura o client do Cloudinary', () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';
    new CloudinaryService();
    expect(configMock).toHaveBeenCalledWith({ cloud_name: 'demo', api_key: 'key', api_secret: 'secret' });
  });

  describe('uploadImage', () => {
    beforeEach(() => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';
    });

    it('resolve com a url segura quando o upload funciona', async () => {
      uploadStreamMock.mockImplementation((_opts: unknown, cb: (err: unknown, result: unknown) => void) => ({
        end: () => cb(null, { secure_url: 'https://res.cloudinary.com/x.jpg' }),
      }));
      const service = new CloudinaryService();

      await expect(service.uploadImage(Buffer.from('img'), 'pulserx/test')).resolves.toEqual({
        url: 'https://res.cloudinary.com/x.jpg',
      });
      expect(uploadStreamMock).toHaveBeenCalledWith({ folder: 'pulserx/test', resource_type: 'image' }, expect.any(Function));
    });

    it('rejeita quando o Cloudinary retorna erro', async () => {
      uploadStreamMock.mockImplementation((_opts: unknown, cb: (err: unknown, result: unknown) => void) => ({
        end: () => cb(new Error('falha upload'), null),
      }));
      const service = new CloudinaryService();

      await expect(service.uploadImage(Buffer.from('img'), 'pulserx/test')).rejects.toThrow('falha upload');
    });

    it('rejeita com erro genérico quando não vem erro nem resultado', async () => {
      uploadStreamMock.mockImplementation((_opts: unknown, cb: (err: unknown, result: unknown) => void) => ({
        end: () => cb(null, null),
      }));
      const service = new CloudinaryService();

      await expect(service.uploadImage(Buffer.from('img'), 'pulserx/test')).rejects.toThrow('Upload sem resposta do Cloudinary');
    });
  });
});
