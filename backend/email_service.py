"""Emergent managed email (Resend) — transactional sends only."""
import os
import re
import ipaddress
import logging
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                     headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        try:
            code = e.response.json().get("code", "")
        except ValueError:
            code = ""
        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
            logger.warning(f"Email paused: {code} ({e.response.status_code}): {e.response.text}")
            raise HTTPException(status_code=503, detail="email_unavailable")
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail="email_failed")


RESET_TEXT = {
    "pt": ("Seu código para redefinir a senha", "Olá! Use o código abaixo no app para criar uma nova senha. Ele vale por 15 minutos.", "Se você não pediu isso, ignore este e-mail. Nunca pedimos sua senha por e-mail."),
    "en": ("Your password reset code", "Hi! Use the code below in the app to create a new password. It is valid for 15 minutes.", "If you didn't request this, ignore this email. We never ask for your password by email."),
    "es": ("Tu código para restablecer la contraseña", "¡Hola! Usa el código de abajo en la app para crear una nueva contraseña. Vale por 15 minutos.", "Si no lo pediste, ignora este email. Nunca pedimos tu contraseña por email."),
    "fr": ("Votre code de réinitialisation", "Bonjour ! Utilisez le code ci-dessous dans l'app pour créer un nouveau mot de passe. Il est valable 15 minutes.", "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail. Nous ne demandons jamais votre mot de passe par e-mail."),
    "de": ("Dein Code zum Zurücksetzen des Passworts", "Hallo! Gib den Code unten in der App ein, um ein neues Passwort zu erstellen. Er ist 15 Minuten gültig.", "Falls du das nicht angefordert hast, ignoriere diese E-Mail. Wir fragen nie per E-Mail nach deinem Passwort."),
}


def reset_email(lang: str, code: str) -> tuple[str, str]:
    subject, intro, footer = RESET_TEXT.get(lang, RESET_TEXT["en"])
    from html import escape
    html = (f'<table role="presentation" width="100%" style="background:#FDF9F3"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#2D2A26">'
            f'<p style="font-size:18px;font-weight:bold;color:#FF7F6A">{escape(EMAIL_FROM_NAME)}</p>'
            f'<p style="font-size:15px">{escape(intro)}</p>'
            f'<p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#FFEAE6;padding:16px;text-align:center;border-radius:12px">{escape(code)}</p>'
            f'<p style="font-size:12px;color:#7A7571">{escape(footer)}</p></td></tr></table>')
    return f"{subject} - {EMAIL_FROM_NAME}", html
