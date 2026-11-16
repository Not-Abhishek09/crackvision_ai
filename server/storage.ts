import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export interface StorageProvider {
  readonly backendName: 'local' | 's3';
  readonly locationLabel: string;
  saveFile(key: string, data: Buffer, contentType: string): Promise<string>;
  readFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

function sanitizeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) {
    throw new Error('Invalid storage key path');
  }
  return normalized;
}

class LocalDiskStorageProvider implements StorageProvider {
  readonly backendName = 'local' as const;
  readonly rootDir: string;
  readonly locationLabel: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.locationLabel = this.rootDir;
  }

  private resolvePath(key: string): string {
    const cleanKey = sanitizeKey(key);
    const resolved = path.resolve(this.rootDir, cleanKey);
    if (!resolved.startsWith(this.rootDir + path.sep) && resolved !== this.rootDir) {
      throw new Error('Storage key escapes configured storage root');
    }
    return resolved;
  }

  async saveFile(key: string, data: Buffer): Promise<string> {
    const cleanKey = sanitizeKey(key);
    const targetPath = this.resolvePath(cleanKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, data);
    return cleanKey;
  }

  async readFile(key: string): Promise<Buffer> {
    const targetPath = this.resolvePath(key);
    return fs.readFile(targetPath);
  }

  async deleteFile(key: string): Promise<void> {
    const targetPath = this.resolvePath(key);
    try {
      await fs.unlink(targetPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const targetPath = this.resolvePath(key);
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}

class S3StorageProvider implements StorageProvider {
  readonly backendName = 's3' as const;
  readonly bucket: string;
  readonly locationLabel: string;
  private client: S3Client;

  constructor(config: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }) {
    this.bucket = config.bucket;
    this.locationLabel = `s3://${config.bucket}`;
    this.client = new S3Client({
      region: config.region || 'us-east-1',
      endpoint: config.endpoint || undefined,
      forcePathStyle: Boolean(config.endpoint),
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });
  }

  async saveFile(key: string, data: Buffer, contentType: string): Promise<string> {
    const cleanKey = sanitizeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
        Body: data,
        ContentType: contentType,
      }),
    );
    return cleanKey;
  }

  async readFile(key: string): Promise<Buffer> {
    const cleanKey = sanitizeKey(key);
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
      }),
    );
    if (!res.Body) {
      throw new Error(`Object not found in S3: ${cleanKey}`);
    }
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async deleteFile(key: string): Promise<void> {
    const cleanKey = sanitizeKey(key);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.readFile(key);
      return true;
    } catch {
      return false;
    }
  }
}

let cachedStorage: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cachedStorage) return cachedStorage;

  const backend = (process.env.STORAGE_BACKEND || 'local').toLowerCase();
  if (backend === 's3') {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error('STORAGE_BACKEND is set to "s3" but S3_BUCKET is not configured.');
    }
    cachedStorage = new S3StorageProvider({
      bucket,
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    });
  } else {
    const root = process.env.STORAGE_ROOT || path.resolve(process.cwd(), 'data', 'storage');
    cachedStorage = new LocalDiskStorageProvider(root);
  }

  return cachedStorage;
}
