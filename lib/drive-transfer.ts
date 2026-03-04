import { drive_v3 } from 'googleapis';
import { getDriveService } from './google-auth';

const COPY_CONCURRENCY = 5; // parallel copies for folders

export function parseDriveUrl(url: string): { kind: 'folder' | 'file'; id: string } {
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return { kind: 'folder', id: folderMatch[1] };

  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /([a-zA-Z0-9_-]{25,})/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return { kind: 'file', id: m[1] };
  }

  throw new Error(`Could not parse Drive URL: ${url}`);
}

async function listFolderFiles(
  service: drive_v3.Drive,
  folderId: string
): Promise<drive_v3.Schema$File[]> {
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  do {
    const res = await service.files.list({
      q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageToken,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

// Server-side copy — no download/upload, Google handles it internally (very fast)
async function copyFile(
  service: drive_v3.Drive,
  fileId: string,
  name: string,
  parentId?: string
): Promise<string> {
  const res = await service.files.copy({
    fileId,
    requestBody: {
      name,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });
  return res.data.id!;
}

async function makePublic(service: drive_v3.Drive, fileId: string): Promise<void> {
  await service.permissions.create({
    fileId,
    requestBody: { type: 'anyone', role: 'reader' },
  });
}

// Run tasks with a max concurrency limit
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export async function transferDrive(
  driveUrl: string,
  onProgress?: (msg: string) => void
): Promise<string[]> {
  const log = (msg: string) => {
    console.log(msg);
    onProgress?.(msg);
  };

  const { kind, id } = parseDriveUrl(driveUrl);
  const service = getDriveService('dest'); // source falls back to dest (same account)

  if (kind === 'folder') {
    const meta = await service.files.get({ fileId: id, fields: 'name' });
    const folderName = meta.data.name || 'Untitled';

    log(`Listing files in "${folderName}"...`);
    const files = await listFolderFiles(service, id);
    log(`Found ${files.length} file(s) — copying in parallel...`);

    if (files.length === 0) return [];

    const destFolderRes = await service.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    const destFolderId = destFolderRes.data.id!;

    const tasks = files.map((file) => async () => {
      log(`Copying: ${file.name}`);
      await copyFile(service, file.id!, file.name!, destFolderId);
      log(`Done: ${file.name}`);
    });

    await withConcurrency(tasks, COPY_CONCURRENCY);

    await makePublic(service, destFolderId);
    log('Transfer complete');
    return [`https://drive.google.com/drive/folders/${destFolderId}?usp=sharing`];
  } else {
    const meta = await service.files.get({ fileId: id, fields: 'id,name,mimeType' });

    log(`Copying: ${meta.data.name}`);
    const newId = await copyFile(service, id, meta.data.name!);

    await makePublic(service, newId);
    log('Transfer complete');
    return [`https://drive.google.com/file/d/${newId}/view?usp=sharing`];
  }
}
