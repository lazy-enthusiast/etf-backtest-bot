import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { symbolToFile } from '../engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const MAPPING_PATH = path.join(ROOT, 'backtest', 'index-mapping.json');

export async function loadMapping() {
  return JSON.parse(await readFile(MAPPING_PATH, 'utf8'));
}

export async function readCached(symbol) {
  const file = path.join(DATA_DIR, symbolToFile(symbol));
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeCache(data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, symbolToFile(data.symbol)), JSON.stringify(data));
}

// data/manifest.json：前端用來列出可回測代號，不必逐一下載價格檔
export async function writeManifest() {
  const symbols = {};
  for (const file of (await readdir(DATA_DIR)).sort()) {
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const d = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
    symbols[d.symbol] = {
      name: d.name, currency: d.currency, instrumentType: d.instrumentType,
      frequency: d.frequency || 'daily', firstDate: d.firstDate, lastDate: d.lastDate
    };
  }
  await writeFile(path.join(DATA_DIR, 'manifest.json'), JSON.stringify({ updatedAt: new Date().toISOString(), symbols }, null, 1));
}
