import {readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const root = resolve(import.meta.dirname, '../..');
const db = new DatabaseSync(process.argv[2]);
db.exec('PRAGMA foreign_keys = ON;');
for (const name of readdirSync(join(root, 'database/migrations'), {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) db.exec(readFileSync(join(root, 'database/migrations', name, 'migration.sql'), 'utf8'));
db.close();
