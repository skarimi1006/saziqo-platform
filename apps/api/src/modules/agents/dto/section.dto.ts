export interface RecentActivityItem {
  kind: 'install' | 'purchase' | 'review';
  userHandle: string;
  listingSlug: string;
  listingTitleFa: string;
  timestamp: string;
}
