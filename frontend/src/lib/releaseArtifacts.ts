import type { ReleaseSession } from '../types/contentRelease';
import type { ReleaseDeliveryProof } from './contentReleaseDelivery';
import { canonicalizeJson } from './canonicalJson';

const canonical = (value: unknown) => JSON.stringify(canonicalizeJson(value));

function artifactProof(session: ReleaseSession, artifact: DeliveryArtifact) {
  const proof = session.delivery ?? artifact.proof;
  if (artifact.owner !== session.ownerSubject || artifact.releaseId !== session.bundle.releaseId || artifact.bundle !== canonical(session.bundle) ||
      !['jobId', 'buildId', 'sha256', 'cards'].every(key => proof[key as keyof typeof proof] === artifact.proof[key as keyof typeof proof])) throw new Error('Saved bytes differ from the completed publication.');
  return proof;
}

export interface DeliveryArtifact { owner: string; releaseId: string; bundle: string; proof: ReleaseDeliveryProof; bytes: Uint8Array }
interface ArtifactFile { getFile(): Promise<{ text(): Promise<string> }>; createWritable(): Promise<{ write(value: string | Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }
export interface ArtifactDirectory { getDirectoryHandle(name: string, options: { create: boolean }): Promise<ArtifactDirectory>; getFileHandle(name: string, options?: { create: boolean }): Promise<ArtifactFile>; queryPermission(options: { mode: 'readwrite' }): Promise<string> }

async function storage<T>(key: IDBValidKey, guard: () => void, value?: T): Promise<T | undefined> {
  guard();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('devcards-release-artifacts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('artifacts');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Artifact storage is blocked by another tab.'));
  });
  try { guard(); } catch (error) { db.close(); throw error; }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('artifacts', value === undefined ? 'readonly' : 'readwrite');
    const request = value === undefined ? tx.objectStore('artifacts').get(key) : tx.objectStore('artifacts').put(value, key);
    tx.oncomplete = () => { db.close(); try { guard(); resolve(value ?? request.result); } catch (error) { reject(error); } };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Could not persist release artifacts.')); };
  });
}

export async function saveDeliveryArtifact(session: ReleaseSession, proof: ReleaseDeliveryProof, bytes: Uint8Array, guard: () => void) {
  const artifact: DeliveryArtifact = { owner: session.ownerSubject, releaseId: session.bundle.releaseId, bundle: canonical(session.bundle), proof, bytes };
  await storage([artifact.owner, artifact.releaseId], guard, artifact);
}
export async function loadDeliveryArtifact(session: ReleaseSession, guard: () => void): Promise<DeliveryArtifact | undefined> {
  const artifact = await storage<DeliveryArtifact>([session.ownerSubject, session.bundle.releaseId], guard);
  if (artifact && (artifact.owner !== session.ownerSubject || artifact.releaseId !== session.bundle.releaseId || artifact.bundle !== canonical(session.bundle))) throw new Error('Saved artifact differs from the frozen release.');
  return artifact;
}
export async function loadArtifactDirectory(owner: string, guard: () => void): Promise<ArtifactDirectory | undefined> {
  if (!supportsArtifactDirectory()) return;
  const directory = await storage<ArtifactDirectory>(['directory', owner], guard);
  if (!directory) return;
  const permission = await directory.queryPermission({ mode: 'readwrite' }); guard();
  return permission === 'granted' ? directory : undefined;
}
export function supportsArtifactDirectory() { return typeof window !== 'undefined' && Boolean(globalThis.navigator?.locks) && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'; }
export async function chooseArtifactDirectory(owner: string, guard: () => void): Promise<ArtifactDirectory> {
  guard();
  const picker = (window as unknown as { showDirectoryPicker(options: { mode: string }): Promise<ArtifactDirectory> }).showDirectoryPicker;
  const directory = await picker.call(window, { mode: 'readwrite' }); guard();
  await storage(['directory', owner], guard, directory); return directory;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function writeReleaseArtifacts(directory: ArtifactDirectory, session: ReleaseSession, guard: () => void, artifact?: DeliveryArtifact) {
  guard();
  const id = await sha256(new TextEncoder().encode(session.ownerSubject + ':' + session.bundle.releaseId)); guard();
  const folder = await directory.getDirectoryHandle('recallsmith-' + id.slice(0, 24), { create: true }); guard();
  const bundle = JSON.stringify(session.bundle);
  try {
    const file = await folder.getFileHandle('release-bundle.json'); guard();
    const previous = await file.getFile(); guard();
    const raw = await previous.text(); guard();
    if (canonical(JSON.parse(raw)) !== canonical(session.bundle)) throw new Error('Save folder already contains a different frozen release.');
  } catch (error) { if (!(error && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError')) throw error; }
  async function write(name: string, value: string | Uint8Array) {
    guard(); const file = await folder.getFileHandle(name, { create: true }); guard();
    const writer = await file.createWritable();
    try { guard(); await writer.write(typeof value === 'string' ? value : new Blob([value.slice().buffer])); guard(); await writer.close(); guard(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
  await write('release-bundle.json', bundle);
  if (artifact) {
    const completedProof = artifactProof(session, artifact);
    if (artifact.owner !== session.ownerSubject || artifact.bundle !== canonical(session.bundle) || artifact.releaseId !== session.bundle.releaseId || await sha256(artifact.bytes) !== artifact.proof.sha256) throw new Error('Verified artifact binding changed.');
    guard(); await write('after-deck.json', artifact.bytes);
    const receipt = { status: 'PUBLISHED_AND_VERIFIED', ...completedProof, releaseId: session.bundle.releaseId, bundleSha256: await sha256(new TextEncoder().encode(bundle)) };
    await write('publication-verification.json', JSON.stringify(receipt));
  }
  await write('console-journal.json', JSON.stringify(session));
}

export function releaseArtifactDownload(session: ReleaseSession, artifact: DeliveryArtifact) {
  let binary = '';
  for (let i = 0; i < artifact.bytes.length; i += 32768) binary += String.fromCharCode(...artifact.bytes.subarray(i, i + 32768));
  return { schema: 'aws-basics-completed-artifacts-v1', session, proof: artifactProof(session, artifact), deckBase64: btoa(binary) };
}
