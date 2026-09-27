import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

function requireCloudinaryConfig(): { cloud_name: string; api_key: string; api_secret: string } {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error(
      'CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET não configurados — defina as variáveis de ambiente antes de iniciar a aplicação.',
    );
  }
  return { cloud_name, api_key, api_secret };
}

@Injectable()
export class CloudinaryService {
  constructor() {
    cloudinary.config(requireCloudinaryConfig());
  }

  /** Sobe uma imagem (buffer já validado por mimetype/tamanho no controller) numa pasta do Cloudinary. */
  async uploadImage(buffer: Buffer, folder: string): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (err, result) => {
          if (err || !result) return reject(err ?? new Error('Upload sem resposta do Cloudinary'));
          resolve({ url: result.secure_url });
        },
      );
      stream.end(buffer);
    });
  }
}
