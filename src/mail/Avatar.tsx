import { memo, useContext, useState } from "react";
import { logoDomain, type Mail, type Provider } from "../../shared/types";
import { PrivacyContext } from "../ui/Privacy";
import { Cloud, Gmail, Mail as MailIcon } from "../ui/icons";

export function ProviderIcon({ provider }: { provider: Provider }) {
  return (
    <span className={`provider-icon ${provider === "gmail-imap" ? "gmail" : provider}`} aria-hidden="true">
      {provider === "gmail" || provider === "gmail-imap" ? (
        <Gmail />
      ) : provider === "icloud" ? (
        <Cloud />
      ) : provider === "imap" ? (
        <MailIcon color="currentColor" />
      ) : (
        <b>
          {provider === "fastmail" ? "F" : "y!"}
        </b>
      )}
    </span>
  );
}
// A stable tint per sender so one person's mail keeps the same avatar color.
export function avatarTone(address: string): number {
  let hash = 0;
  for (const ch of address.toLowerCase()) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  return Math.abs(hash) % 4;
}

export const Avatar = memo(function Avatar({
  mail,
  provider,
}: {
  mail: Pick<Mail, "address" | "sender">;
  provider?: Provider;
}) {
  const domain = logoDomain(mail.address);
  const [broken, setBroken] = useState(false);
  const { on } = useContext(PrivacyContext);
  const initial = mail.sender.slice(0, 1).toUpperCase();
  return (
    <span className="avatar" data-tone={avatarTone(mail.address)} aria-hidden="true">
      {!on && domain && !broken ? (
        <img
          className="avatar-logo"
          src={`/api/logo/${domain}`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="avatar-letter">
          {on ? "·" : initial}
        </span>
      )}
      {provider && <ProviderIcon provider={provider} />}
    </span>
  );
});
