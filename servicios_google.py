#!/usr/bin/env python3
"""Fase 7 - Google Calendar y Gmail, solo con la libreria estandar.

OAuth 2.0 para apps de escritorio: el navegador del PC abre el consentimiento,
Google redirige a un servidor HTTP local (127.0.0.1, puerto libre) y el codigo
se canjea con PKCE. El token se guarda en un JSON del proyecto y se refresca solo.

Alcances: calendar.events.owned (ver y crear eventos en calendarios propios) y
gmail.send (solo enviar: no puede leer el correo).

Autorizar (una vez, y otra cada 7 dias mientras la app siga en modo "Testing"):
    .venv/bin/python servicios_google.py autorizar
"""

import base64
import hashlib
import http.server
import json
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime
from email.message import EmailMessage

ALCANCES = ("https://www.googleapis.com/auth/calendar.events.owned",
            "https://www.googleapis.com/auth/gmail.send")
URL_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
URL_TOKEN = "https://oauth2.googleapis.com/token"
URL_EVENTOS = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
URL_ENVIAR = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


class NoAutorizado(Exception):
    """Falta el JSON del cliente o el token, o Google ya no acepta el token (caduco)."""


def _cliente(ruta):
    with open(ruta, encoding="utf-8") as f:
        d = json.load(f)
    return d.get("installed") or d      # el JSON de un cliente "Desktop app" trae "installed"


def _guardar_token(ruta, token):
    tmp = ruta + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
        json.dump(token, f, indent=2)
    os.replace(tmp, ruta)               # solo el usuario puede leerlo: da acceso a la cuenta


def _post_form(url, campos, timeout=15):
    datos = urllib.parse.urlencode(campos).encode("ascii")
    with urllib.request.urlopen(urllib.request.Request(url, data=datos), timeout=timeout) as r:
        return json.loads(r.read())


def _rfc3339(t):
    """datetime local sin zona -> "2026-10-22T15:00:00-05:00"."""
    return t.astimezone().isoformat(timespec="seconds")


def _local(texto):
    """"2026-10-22T15:00:00-05:00" (o con Z) -> datetime local sin zona."""
    return datetime.fromisoformat(texto.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)


def autorizar(ruta_cliente, ruta_token, abrir=webbrowser.open):
    """Consentimiento en el navegador; guarda el token. Bloquea hasta que Google responde."""
    cliente = _cliente(ruta_cliente)
    verificador = secrets.token_urlsafe(64)
    reto = base64.urlsafe_b64encode(hashlib.sha256(verificador.encode("ascii")).digest()).rstrip(b"=").decode()
    estado = secrets.token_urlsafe(16)
    recibido = {}

    class Respuesta(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            recibido.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("<p>Listo. Ya puedes cerrar esta pestaña.</p>".encode("utf-8"))

        def log_message(self, *args):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Respuesta)
    redirect = "http://127.0.0.1:%d" % srv.server_port
    url = URL_AUTH + "?" + urllib.parse.urlencode({
        "client_id": cliente["client_id"], "redirect_uri": redirect, "response_type": "code",
        "scope": " ".join(ALCANCES), "code_challenge": reto, "code_challenge_method": "S256",
        "state": estado, "access_type": "offline", "prompt": "consent"})
    print("Abriendo el navegador. Si no se abre, copia esta direccion:\n%s\n" % url)
    abrir(url)
    while "code" not in recibido and "error" not in recibido:
        srv.handle_request()            # el navegador tambien pide /favicon.ico
    srv.server_close()
    if recibido.get("state") != estado or "code" not in recibido:
        raise NoAutorizado("Google no autorizo: %s" % recibido.get("error", "el estado no coincide"))

    token = _post_form(URL_TOKEN, {
        "code": recibido["code"], "client_id": cliente["client_id"],
        "client_secret": cliente.get("client_secret", ""), "redirect_uri": redirect,
        "grant_type": "authorization_code", "code_verifier": verificador})
    token["expira"] = time.time() + token.get("expires_in", 3600)
    token["autorizado"] = datetime.now().isoformat(timespec="seconds")
    _guardar_token(ruta_token, token)
    return token


class Google:
    """Calendar y Gmail con el token guardado. Seguro entre hilos."""

    def __init__(self, ruta_cliente, ruta_token):
        for ruta in (ruta_cliente, ruta_token):
            if not os.path.exists(ruta):
                raise NoAutorizado("falta %s" % ruta)
        self.ruta_token = ruta_token
        self._cliente = _cliente(ruta_cliente)
        with open(ruta_token, encoding="utf-8") as f:
            self._token = json.load(f)
        self.autorizado = self._token.get("autorizado")     # caduca a los 7 dias en modo Testing
        self._lock = threading.Lock()

    def _acceso(self):
        with self._lock:
            if time.time() > self._token.get("expira", 0) - 60:
                try:
                    t = _post_form(URL_TOKEN, {
                        "client_id": self._cliente["client_id"],
                        "client_secret": self._cliente.get("client_secret", ""),
                        "refresh_token": self._token.get("refresh_token", ""),
                        "grant_type": "refresh_token"})
                except urllib.error.HTTPError as e:
                    raise NoAutorizado("Google rechazo el token (HTTP %d): hay que volver a autorizar" % e.code)
                self._token["access_token"] = t["access_token"]
                self._token["expira"] = time.time() + t.get("expires_in", 3600)
                _guardar_token(self.ruta_token, self._token)
            return self._token["access_token"]

    def _pedir(self, metodo, url, cuerpo=None):
        datos = json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None
        req = urllib.request.Request(url, data=datos, method=metodo, headers={
            "Authorization": "Bearer " + self._acceso(), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise NoAutorizado("Google respondio HTTP %d: %s" % (e.code, e.read()[:200]))
            raise

    def eventos(self, desde, hasta):
        """Eventos del calendario principal entre dos datetimes locales.

        -> [{"titulo", "inicio"}], inicio None si es de todo el dia.
        """
        q = urllib.parse.urlencode({"timeMin": _rfc3339(desde), "timeMax": _rfc3339(hasta),
                                    "singleEvents": "true", "orderBy": "startTime", "maxResults": 20})
        salida = []
        for e in self._pedir("GET", URL_EVENTOS + "?" + q).get("items", []):
            inicio = e.get("start", {}).get("dateTime")
            salida.append({"titulo": e.get("summary") or "un evento sin título",
                           "inicio": _local(inicio) if inicio else None})
        return salida

    def crear_evento(self, titulo, inicio, fin):
        """-> id del evento creado."""
        return self._pedir("POST", URL_EVENTOS, {
            "summary": titulo, "start": {"dateTime": _rfc3339(inicio)},
            "end": {"dateTime": _rfc3339(fin)}}).get("id")

    def enviar_correo(self, para, asunto, cuerpo):
        """Envia de verdad. Solo lo llama la confirmacion por voz ("sí, envíalo")."""
        m = EmailMessage()
        m["To"] = para
        m["Subject"] = asunto
        m.set_content(cuerpo)
        raw = base64.urlsafe_b64encode(m.as_bytes()).decode("ascii")
        return self._pedir("POST", URL_ENVIAR, {"raw": raw}).get("id")


if __name__ == "__main__":
    if sys.argv[1:] != ["autorizar"]:
        sys.exit("Uso: .venv/bin/python servicios_google.py autorizar")
    import servidor                     # barato: los modelos se cargan en main()
    cliente = os.path.join(servidor.BASE_DIR, servidor.GOOGLE_CLIENTE)
    token = os.path.join(servidor.BASE_DIR, servidor.GOOGLE_TOKEN)
    if not os.path.exists(cliente):
        sys.exit("Falta %s: descargalo de Google Auth platform > Clients (tipo Desktop app)." % cliente)
    autorizar(cliente, token)
    g = Google(cliente, token)
    hoy = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    n = len(g.eventos(hoy, hoy.replace(hour=23, minute=59)))
    print("Autorizado. Token en %s. Hoy hay %d evento(s) en el calendario." % (token, n))
    print("Reinicia el servidor para que lo use. Caduca a los 7 dias mientras la app este en modo Testing.")
