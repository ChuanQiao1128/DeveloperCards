import {
  fetchCloudJournalPart, fetchCloudJournalPointer, putCloudJournalPart, putCloudJournalPointer, type CloudJournalPointer,
} from '../api/contentRelease';
import { sha256 } from './releaseArtifacts';

const PART_BYTES = 720_000;
const MAX_PARTS = 45;
const MAX_JSON_LENGTH = 10_000_000;
const HASH = /^[0-9a-f]{64}$/;
const REVISION = /^"[0-9a-f]{32}"$/;

function assertPointer(pointer: CloudJournalPointer) {
  if (!pointer || !Array.isArray(pointer.parts) || pointer.parts.length > MAX_PARTS ||
    pointer.parts.some(part => !HASH.test(part)) ||
    (pointer.revision === null ? pointer.parts.length !== 0 : !REVISION.test(pointer.revision)))
    throw new Error('The cloud release journal has an invalid revision or part inventory.');
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32_768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32_768));
  return btoa(binary);
}

async function decodeJournal(parts: Uint8Array<ArrayBuffer>[]): Promise<string> {
  const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
      if (text.length > MAX_JSON_LENGTH) throw new Error('The cloud release journal is too large.');
    }
  } finally { await reader.cancel(); }
}

export async function loadCloudReleaseJournal(owner: string): Promise<{ pointer: CloudJournalPointer; raw: string }> {
  const pointer = await fetchCloudJournalPointer(owner);
  assertPointer(pointer);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (const part of pointer.parts) {
    const encoded = await fetchCloudJournalPart(part, owner);
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > PART_BYTES / 3 * 4)
      throw new Error('A cloud release journal part has an invalid size.');
    parts.push(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
  }
  return { pointer, raw: parts.length ? await decodeJournal(parts) : '' };
}

export async function saveCloudReleaseJournal(owner: string, raw: string, current: CloudJournalPointer): Promise<CloudJournalPointer> {
  if (raw.length > MAX_JSON_LENGTH) throw new Error('The release journal is too large.');
  const parts: string[] = [];
  if (raw) {
    const compressed = new Uint8Array(await new Response(new Blob([raw]).stream()
      .pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    if (compressed.length > PART_BYTES * MAX_PARTS) throw new Error('The compressed release journal is too large.');
    const alreadySaved = new Set(current.parts);
    for (let i = 0; i < compressed.length; i += PART_BYTES) {
      const bytes = compressed.slice(i, i + PART_BYTES);
      const part = await sha256(bytes);
      if (!alreadySaved.has(part)) {
        await putCloudJournalPart(part, encode(bytes), owner);
        alreadySaved.add(part);
      }
      parts.push(part);
    }
  }
  const next = await putCloudJournalPointer({ revision: current.revision, parts }, owner);
  assertPointer(next);
  if (!next.revision || next.revision === current.revision || next.parts.join(',') !== parts.join(','))
    throw new Error('The cloud release journal did not confirm the saved revision.');
  return next;
}
