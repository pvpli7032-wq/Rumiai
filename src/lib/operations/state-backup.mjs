import { PrismaClient } from '@prisma/client';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { backupSqliteDatabase, inspectSqliteSnapshot, restoreSqliteDatabase } from './sqlite-backup.mjs';
import { readPersistedUploadUrls } from '../uploads/backup-references.mjs';

const safeName = name => typeof name === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(name) && name !== '.' && name !== '..';
const fileUrl = file => `file:${path.resolve(file).split(path.sep).join('/')}`;

async function requireRegularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw Error('备份只接受普通文件，不接受符号链接或目录。');
  return info;
}
async function requireDirectory(dir) {
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('备份目录类型不正确。');
}
async function fingerprint(file) {
  const info = await requireRegularFile(file), hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return { bytes: info.size, sha256: hash.digest('hex') };
}
async function referencesFromSnapshot(file) {
  const client = new PrismaClient({ datasources: { db: { url: fileUrl(file) } }, log: [] });
  try {
    await client.$executeRawUnsafe('PRAGMA query_only = ON');
    return await readPersistedUploadUrls(client);
  } finally { await client.$disconnect(); }
}
async function validateReferences(database, files) {
  const available = new Set(files.map(file => `/uploads/${file.name}`));
  const references = await referencesFromSnapshot(database);
  if (references.some(url => !available.has(url))) throw Error('数据库引用了缺失或不支持的上传文件，备份不能作为完整恢复点。');
  return references.length;
}
export function validateStateBackupManifest(manifest) {
  if (manifest?.format !== 'xingban-state-backup' || manifest.version !== 1 || !Array.isArray(manifest.uploads) || !manifest.database) throw Error('备份清单格式不正确。');
  const validFingerprint = value => value && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && /^[a-f0-9]{64}$/.test(value.sha256);
  if (!validFingerprint(manifest.database) || manifest.uploads.some(file => !safeName(file.name) || !validFingerprint(file))) throw Error('备份清单文件信息不正确。');
  if (new Set(manifest.uploads.map(file => file.name)).size !== manifest.uploads.length) throw Error('备份清单含重复文件。');
  if (typeof manifest.createdAt !== 'string' || manifest.createdAt.length > 64 || !Number.isFinite(Date.parse(manifest.createdAt)) || !Number.isSafeInteger(manifest.referenceCount) || manifest.referenceCount < 0 || !manifest.counts || typeof manifest.counts !== 'object' || Array.isArray(manifest.counts) || Object.values(manifest.counts).some(count => !Number.isSafeInteger(count) || count < 0)) throw Error('备份清单时间或计数格式不正确。');
}
export function validateStateRestoreRecord(record, manifest) {
  if (record?.format !== 'xingban-state-restore' || record.version !== 1 || typeof record.completedAt !== 'string' || record.completedAt.length > 64 || !Number.isFinite(Date.parse(record.completedAt)) || record.sourceCreatedAt !== manifest.createdAt || record.sourceDatabaseSha256 !== manifest.database.sha256 || record.integrity !== 'ok' || record.foreignKeys !== 'ok' || record.uploadedFiles !== manifest.uploads.length) throw Error('恢复结果记录与备份清单不一致。');
}
async function matchFingerprint(file, expected) {
  const actual = await fingerprint(file);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw Error('备份文件大小或 SHA256 不匹配。');
}

/** Stop application writers first. A manifest is published only after all files and references verify. */
export async function createStateBackup(sourceDatabase, sourceUploads, target) {
  target = path.resolve(target);
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(target); // Exclusive new directory; never reuse or delete user files.
  const database = path.join(target, 'database.db'), uploads = path.join(target, 'uploads');
  const snapshot = await backupSqliteDatabase(sourceDatabase, database);
  await mkdir(uploads);
  let entries;
  try { await requireDirectory(sourceUploads); entries = await readdir(sourceUploads, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!safeName(entry.name) || !entry.isFile() || entry.isSymbolicLink()) throw Error('上传目录含不支持的文件名、子目录或符号链接。');
    const from = path.join(sourceUploads, entry.name), to = path.join(uploads, entry.name);
    const before = await fingerprint(from);
    await copyFile(from, to, constants.COPYFILE_EXCL);
    await matchFingerprint(to, before);
    files.push({ name: entry.name, ...before });
  }
  const referenceCount = await validateReferences(database, files);
  const manifest = { format: 'xingban-state-backup', version: 1, createdAt: new Date().toISOString(), database: await fingerprint(database), counts: snapshot.counts, uploads: files, referenceCount };
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return inspectStateBackup(target);
}

export async function inspectStateBackup(source) {
  source = path.resolve(source); await requireDirectory(source);
  const manifestFile = path.join(source, 'manifest.json'); await requireRegularFile(manifestFile);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')); validateStateBackupManifest(manifest);
  const database = path.join(source, 'database.db'), uploads = path.join(source, 'uploads');
  await matchFingerprint(database, manifest.database); await requireDirectory(uploads);
  const entries = await readdir(uploads, { withFileTypes: true });
  if (entries.length !== manifest.uploads.length || entries.some(entry => !entry.isFile() || entry.isSymbolicLink() || !manifest.uploads.some(file => file.name === entry.name))) throw Error('备份上传目录与清单不一致。');
  for (const file of manifest.uploads) await matchFingerprint(path.join(uploads, file.name), file);
  const snapshot = await inspectSqliteSnapshot(database);
  if (JSON.stringify(snapshot.counts) !== JSON.stringify(manifest.counts)) throw Error('数据库记录计数与清单不一致。');
  const referenceCount = await validateReferences(database, manifest.uploads);
  if (referenceCount !== manifest.referenceCount) throw Error('上传引用计数与清单不一致。');
  return { source, database, uploads, manifest, ...snapshot };
}

/** Restore into a NEW directory; the operator later chooses database and upload locations together. */
export async function restoreStateBackup(source, target) {
  const verified = await inspectStateBackup(source); target = path.resolve(target);
  await mkdir(path.dirname(target), { recursive: true }); await mkdir(target);
  await restoreSqliteDatabase(verified.database, path.join(target, 'database.db'));
  await mkdir(path.join(target, 'uploads'));
  for (const file of verified.manifest.uploads) await copyFile(path.join(verified.uploads, file.name), path.join(target, 'uploads', file.name), constants.COPYFILE_EXCL);
  await copyFile(path.join(verified.source, 'manifest.json'), path.join(target, 'manifest.json'), constants.COPYFILE_EXCL);
  const report = await inspectStateBackup(target);
  const restoration = {format: 'xingban-state-restore', version: 1, completedAt: new Date().toISOString(), sourceCreatedAt: verified.manifest.createdAt, sourceDatabaseSha256: verified.manifest.database.sha256, integrity: report.integrity, foreignKeys: report.foreignKeys, uploadedFiles: verified.manifest.uploads.length};
  await writeFile(path.join(target, 'restore-result.json'), JSON.stringify(restoration, null, 2) + '\n', {flag: 'wx'});
  return {...report, restoration};
}
