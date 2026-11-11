"""Sin Ollama ni Gemini (un comprador recien instalado): Pixel dice que le falta la IA en vez de solo un pitido."""
import http.server
import socket
import threading

import gemini
import llm


def _puerto_cerrado():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    puerto = s.getsockname()[1]
    s.close()                                   # nadie escucha ahi
    return puerto


def test_sin_ollama_dice_que_falta(monkeypatch):
    monkeypatch.setattr(gemini, "activo", lambda: False)
    m = llm.Llm(host="http://127.0.0.1:%d" % _puerto_cerrado(), timeout=3)
    assert "".join(m.responder("hola")) == llm.SIN_IA
    assert m.motor == "ninguno" and m.historial == []          # no se guarda como conversacion
    assert llm._OLLAMA.acquire(timeout=0.1)                    # y suelta el candado
    llm._OLLAMA.release()


def test_ollama_sin_el_modelo_tambien(monkeypatch):
    monkeypatch.setattr(gemini, "activo", lambda: False)

    class Sin404(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error":"model not found"}')

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Sin404)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        m = llm.Llm(host="http://127.0.0.1:%d" % srv.server_address[1], timeout=3)
        assert "".join(m.responder("hola")) == llm.SIN_IA
    finally:
        srv.shutdown()
