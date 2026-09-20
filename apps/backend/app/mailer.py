"""Staff invitation email via Resend (KAN-52/53)."""

from html import escape

import httpx

from .config import settings

RESEND_URL = "https://api.resend.com/emails"


class InvitationEmailError(RuntimeError):
    pass


def send_staff_invitation(email: str, role: str, accept_url: str) -> None:
    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        raise InvitationEmailError("email is not configured (RESEND_API_KEY/RESEND_FROM_EMAIL)")

    safe_url = escape(accept_url, quote=True)
    role_label = escape(role.upper(), quote=True)
    subject = "Your CityWatch Ops invitation"
    text = (
        "You're invited to the CityWatch Ops console as "
        f"{role}. Set your password here: {accept_url}. "
        "This secure link expires in 72 hours and can be used once. "
        "If you weren't expecting this email, you can ignore it."
    )
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CityWatch Ops invitation</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f6f1;color:#17231b;font-family:Verdana,Geneva,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your secure invitation to the CityWatch operations console.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f6f1;">
      <tr>
        <td align="center" style="padding:36px 16px 44px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;">
            <tr>
              <td style="padding:0 8px 16px;color:#285e4a;font-size:12px;font-weight:bold;letter-spacing:2px;line-height:18px;">
                CITYWATCH <span style="color:#839487;font-weight:normal;">/ OPS CONSOLE</span>
              </td>
            </tr>
            <tr>
              <td style="padding:0;background:#153021;border-radius:22px 22px 0 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:34px 36px 32px;">
                      <div style="color:#a9d0b1;font-size:11px;font-weight:bold;letter-spacing:2px;line-height:18px;">TEAM ACCESS</div>
                      <h1 style="margin:12px 0 0;color:#ffffff;font-size:30px;font-weight:normal;letter-spacing:-.7px;line-height:38px;">You're invited to CityWatch Ops.</h1>
                      <p style="margin:14px 0 0;color:#d5e3d7;font-size:14px;line-height:23px;">A focused workspace for reviewing reports, coordinating response, and keeping the city moving.</p>
                    </td>
                    <td width="104" valign="top" align="right" style="padding:34px 30px 0 0;">
                      <div style="width:68px;height:68px;border:1px solid #6f9e7d;border-radius:18px;color:#d9f0dd;font-size:23px;font-weight:bold;line-height:68px;text-align:center;">CW</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0;background:#ffffff;border-radius:0 0 22px 22px;box-shadow:0 16px 40px rgba(35,62,44,.10);">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:34px 36px 30px;">
                      <p style="margin:0;color:#506056;font-size:15px;line-height:25px;">You've been invited to join the operations console with the role:</p>
                      <div style="display:inline-block;margin-top:16px;padding:8px 12px;background:#e6f1e7;border-radius:999px;color:#285e4a;font-size:11px;font-weight:bold;letter-spacing:1.5px;line-height:14px;">{role_label}</div>
                      <p style="margin:26px 0 0;color:#17231b;font-size:16px;font-weight:bold;line-height:25px;">Set your password to activate your account.</p>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
                        <tr>
                          <td style="border-radius:999px;background:#285e4a;">
                            <a href="{safe_url}" style="display:inline-block;padding:15px 24px;border:1px solid #285e4a;border-radius:999px;color:#ffffff;font-size:14px;font-weight:bold;line-height:18px;text-decoration:none;">Activate your account&nbsp; &rarr;</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:18px 0 0;color:#718078;font-size:12px;line-height:20px;">This secure link expires in <strong style="color:#506056;">72 hours</strong> and can be used once.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 36px;"><div style="height:1px;background:#e8eee8;font-size:1px;line-height:1px;">&nbsp;</div></td>
                  </tr>
                  <tr>
                    <td style="padding:24px 36px 30px;">
                      <p style="margin:0;color:#718078;font-size:12px;line-height:20px;"><strong style="color:#506056;">Didn't request access?</strong><br>If this invitation is unexpected, you can safely ignore this email. No account will be activated without your action.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0;color:#8a978e;font-size:11px;line-height:18px;">
                CityWatch Ops &middot; Internal operations console<br>
                This is an automated message; replies are not monitored.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""
    try:
        res = httpx.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": settings.RESEND_FROM_EMAIL,
                "to": [email],
                "subject": subject,
                "html": html,
                "text": text,
            },
            timeout=15,
        )
    except Exception as exc:  # network/timeout — treat as send failure
        raise InvitationEmailError(f"email send failed: {exc}") from exc
    if res.status_code >= 400:
        raise InvitationEmailError(f"email provider rejected the send ({res.status_code})")
