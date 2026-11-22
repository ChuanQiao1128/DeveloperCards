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
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function releaseArtifactDownload(session: ReleaseSession, artifact: DeliveryArtifact) {
  let binary = '';
  for (let i = 0; i < artifact.bytes.length; i += 32768) binary += String.fromCharCode(...artifact.bytes.subarray(i, i + 32768));
  return { schema: 'aws-basics-completed-artifacts-v1', session, proof: artifactProof(session, artifact), deckBase64: btoa(binary) };
}
