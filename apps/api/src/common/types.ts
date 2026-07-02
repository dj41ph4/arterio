/** Authenticated principal attached to the request after JWT verification. */
export interface AuthUser {
  sub: string; // user id
  email: string;
  organizationId: string;
  roles: string[];
  permissions: string[];
}

export interface AccessTokenPayload extends AuthUser {
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  organizationId: string;
  familyId: string;
  type: 'refresh';
}
