import type { GoogleProfile } from "./bridge";
import { initialsOf } from "./model";

/** Foto da conta Google (data: do main) ou as iniciais na cor do perfil. */
export function ProfileAvatar({ profile, size = 40 }: { profile: GoogleProfile; size?: number }) {
  return (
    <span
      className="acct-avatar"
      style={{ width: size, height: size, fontSize: size * 0.38, background: profile.color }}
      aria-hidden="true"
    >
      {profile.avatar ? (
        <img src={profile.avatar} alt="" width={size} height={size} />
      ) : (
        initialsOf(profile.name || profile.label || profile.email)
      )}
    </span>
  );
}
