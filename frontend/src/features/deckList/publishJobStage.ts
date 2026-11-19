import type { PublishJob } from '../../api/authoring';

export const PUBLISH_JOBS_HREF = '/?view=publish-jobs';

export function publishJobStage(job: Pick<PublishJob, 'status' | 'manifestState'>): string {
  if (job.status !== 'SUCCESS' || !job.manifestState) return job.status;
  if (job.manifestState === 'pending') return 'Build committed · manifest pending';
  if (job.manifestState === 'needs_attention') return 'Build committed · manifest needs attention';
  return 'SUCCESS';
}
