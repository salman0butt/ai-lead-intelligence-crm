export type CampaignStatus = 'DRAFT' | 'PLANNING' | 'DISCOVERING' | 'PAUSED' | 'CANCELLED';
export type CampaignLifecycleAction = 'start' | 'pause' | 'resume' | 'cancel';

export interface CampaignResponse {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  name: string;
  country: string;
  region: string | null;
  city: string | null;
  niche: string;
  requestedLeadCount: number;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignGeography {
  country: string;
  region: string | null;
  city: string | null;
}

const actionsByStatus: Record<CampaignStatus, readonly CampaignLifecycleAction[]> = {
  DRAFT: ['start', 'cancel'],
  PLANNING: ['pause', 'cancel'],
  DISCOVERING: ['pause', 'cancel'],
  PAUSED: ['resume', 'cancel'],
  CANCELLED: [],
};

export function formatCampaignGeography({ country, region, city }: CampaignGeography): string {
  return [city, region, country].filter((part): part is string => Boolean(part)).join(', ');
}

export function getCampaignActions(status: CampaignStatus): CampaignLifecycleAction[] {
  return [...actionsByStatus[status]];
}
