import { useAuthStore } from '@/store/auth.store';

function matchesPermission(userPerms: string[], required: string): boolean {
  for (const perm of userPerms) {
    if (perm === 'super:everything') return true;
    if (perm === required) return true;
    // Wildcard: user has 'agents:*:*', required is 'agents:read:listing'
    const userParts = perm.split(':');
    const reqParts = required.split(':');
    if (userParts.length !== reqParts.length) continue;
    if (userParts.every((seg, i) => seg === '*' || seg === reqParts[i])) return true;
  }
  return false;
}

export function usePermission(code: string): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  return matchesPermission(permissions, code);
}
