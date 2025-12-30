import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';

export function createStorage(config) {
  if (config.type === 'cloudinary') {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret
    });
    
    return {
      async upload(filePath, filename) {
        // Remove extension from filename to avoid Cloudinary adding it again
        const nameWithoutExt = path.parse(filename).name;
        const result = await cloudinary.uploader.upload(filePath, {
          public_id: nameWithoutExt,
          resource_type: 'auto',
          folder: 'beardedvibes'
        });
        fs.unlinkSync(filePath);
        return result.secure_url;
      },
      
      getUrl(filename) {
        return filename; // Already full URL from cloudinary
      }
    };
  }
  
  // Local storage fallback
  const uploadsDir = config.uploadsDir;
  fs.mkdirSync(uploadsDir, { recursive: true });
  
  return {
    async upload(filePath, filename) {
      return `/uploads/${filename}`;
    },
    
    getUrl(filename) {
      return `/uploads/${filename}`;
    }
  };
}
