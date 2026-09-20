"""Staff invitation email via Resend (KAN-52/53).

Fails closed: if RESEND_API_KEY/RESEND_FROM_EMAIL are unset or Resend rejects the
send, this raises so the caller never leaves a usable invitation behind.
"""

import httpx

from .config import settings

RESEND_URL = "https://api.resend.com/emails"


class InvitationEmailError(RuntimeError):
    pass


def send_staff_invitation(email: str, role: str, accept_url: str) -> None:
    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        raise InvitationEmailError("email is not configured (RESEND_API_KEY/RESEND_FROM_EMAIL)")

    subject = "You're invited to the CityWatch ops console"
    html = (
        "<p>You've been invited to join the CityWatch operations console "
        f"as <strong>{role}</strong>.</p>"
        f'<p><a href="{accept_url}">Set your password and activate your account</a> '
        "(this link expires in 72 hours and can be used once).</p>"
        "<p>If you weren't expecting this, you can ignore this email.</p>"
    )
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
            },
            timeout=15,
        )
    except Exception as exc:  # network/timeout — treat as send failure
        raise InvitationEmailError(f"email send failed: {exc}") from exc
    if res.status_code >= 400:
        raise InvitationEmailError(f"email provider rejected the send ({res.status_code})")
