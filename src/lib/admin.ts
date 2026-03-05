const ADMIN_EMAILS = [
  'saketmugunda123@gmail.com',
  'mihirmirpuri@utexas.edu',
];

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}
