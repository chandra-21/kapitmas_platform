import { useQuery } from '@tanstack/react-query'
import { getMyPermissions, getMyProfile } from '@/lib/api'
import type { UserResponse } from '@/lib/api'

export function usePermissions() {
  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: getMyProfile,
  })

  const { data: permissions = [] } = useQuery({
    queryKey: ['my-permissions'],
    queryFn: getMyPermissions,
    enabled: !!profile,
  })

  const isAdmin = profile?.role === 'admin'

  function can(key: string): boolean {
    if (isAdmin) return true
    return permissions.includes(key)
  }

  return { can, isAdmin, permissions, loading: !profile, profile: profile as UserResponse | undefined }
}
