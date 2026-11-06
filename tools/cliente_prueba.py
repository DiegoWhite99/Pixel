#!/usr/bin/env python3
"""Cliente de prueba: simula al ESP32 para validar el servidor sin hardware.

Manda audio PCM 16 kHz/16 bit/mono en chunks de 20 ms, en tiempo real,
respetando el mismo protocolo que el firmware.

Uso:
    python3 tools/cliente_prueba.py                 # audio sintetico
    python3 tools/cliente_prueba.py archivo.wav     # un WAV 16k mono 16-bit
    python3 tools/cliente_prueba.py --host 192.168.1.216

Solo libreria estandar.
"""

import argparse
import array
import math
import socket
import struct
import sys
import threading
import time
import wave

SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2
FRAME_MS = 20
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
FRAME_BYTES = FRAME_SAMPLES * SAMPLE_WIDTH

MSG_AUDIO_IN = 0x01
MSG_AUDIO_OUT = 0x02
MSG_END_TURN = 0x03
MSG_DEBUG = 0x04


def pcm_sintetico():
    """silencio - rafaga - silencio - rafaga corta - silencio.

    Debe producir exactamente 2 frases en ./capturas.
    """
    plan = [
        (1.0, None),        # silencio
        (1.5, [220, 440]),  # "frase" 1
        (1.2, None),        # silencio > 700 ms -> cierra la frase 1
        (0.8, [330, 660]),  # "frase" 2
        (1.2, None),        # silencio -> cierra la frase 2
    ]
    out = array.array("h")
    t = 0.0
    dt = 1.0 / SAMPLE_RATE
    for dur, tonos in plan:
        n = int(dur * SAMPLE_RATE)
        for i in range(n):
            if tonos is None:
                # ruido de fondo bajo, deterministico
                v = int(120 * math.sin(2 * math.pi * 60 * t))
            else:
                v = 0
                for f in tonos:
                    v += int(6000 * math.sin(2 * math.pi * f * t))
                # envolvente para que no empiece ni acabe de golpe
                pos = i / n
                env = min(1.0, pos * 12, (1.0 - pos) * 12)
                v = int(v * env)
            out.append(max(-32768, min(32767, v)))
            t += dt
    if sys.byteorder == "big":
        out.byteswap()
    return out.tobytes()


def pcm_de_wav(path):
    with wave.open(path, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != SAMPLE_RATE:
            sys.exit("El WAV debe ser 16000 Hz, mono, 16 bits. Este es %d Hz, %d canal(es), %d bits."
                     % (wf.getframerate(), wf.getnchannels(), wf.getsampwidth() * 8))
        return wf.readframes(wf.getnframes())


def escuchar(sock, estado):
    """Lee lo que manda el servidor: debug (0x04), audio (0x02) y fin (0x03).

    El audio de la respuesta se junta y se guarda como WAV para poder oirlo.
    """
    buf = b""
    voz = bytearray()
    n_chunks = 0
    try:
        while True:
            chunk = sock.recv(8192)
            if not chunk:
                break
            buf += chunk
            while len(buf) >= 5:
                msg_type, length = struct.unpack("<BI", buf[:5])
                if len(buf) < 5 + length:
                    break
                payload = buf[5:5 + length]
                buf = buf[5 + length:]
                if msg_type == MSG_DEBUG:
                    print("  <- debug: %s" % payload.decode("utf-8", "replace"))
                elif msg_type == MSG_AUDIO_OUT:
                    voz += payload
                    n_chunks += 1
                elif msg_type == MSG_END_TURN:
                    seg = len(voz) / (SAMPLE_RATE * SAMPLE_WIDTH)
                    print("  <- 0x03 FIN DE TURNO: %d chunks 0x02, %.2f s de voz"
                          % (n_chunks, seg))
                    if voz:
                        salida = "respuesta_%02d.wav" % (estado["n"] + 1)
                        with wave.open(salida, "wb") as wf:
                            wf.setnchannels(1)
                            wf.setsampwidth(SAMPLE_WIDTH)
                            wf.setframerate(SAMPLE_RATE)
                            wf.writeframes(bytes(voz))
                        print("  <- respuesta guardada en %s  (escuchala con: aplay %s)"
                              % (salida, salida))
                        estado["n"] += 1
                    voz = bytearray()
                    n_chunks = 0
                else:
                    print("  <- mensaje tipo 0x%02x (%d bytes)" % (msg_type, length))
    except OSError as e:
        if not estado.get("cerrando"):
            print("  <- el hilo de escucha termino: %s: %s" % (type(e).__name__, e))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav", nargs="?", help="WAV 16k mono 16-bit (si se omite, audio sintetico)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--fin-de-turno", action="store_true",
                    help="mandar 0x03 al terminar el audio")
    ap.add_argument("--espera", type=float, default=45.0,
                    help="segundos a esperar la respuesta antes de cerrar")
    args = ap.parse_args()

    pcm = pcm_de_wav(args.wav) if args.wav else pcm_sintetico()
    dur = len(pcm) / (SAMPLE_RATE * SAMPLE_WIDTH)
    print("Conectando a %s:%d ..." % (args.host, args.port))

    sock = socket.create_connection((args.host, args.port), timeout=5)
    sock.settimeout(None)   # el timeout de 5 s es solo para conectar
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    estado = {"n": 0}
    threading.Thread(target=escuchar, args=(sock, estado), daemon=True).start()

    print("Enviando %.1f s de audio en chunks de %d ms ..." % (dur, FRAME_MS))
    t0 = time.monotonic()
    enviados = 0
    for off in range(0, len(pcm), FRAME_BYTES):
        frame = pcm[off:off + FRAME_BYTES]
        sock.sendall(struct.pack("<BI", MSG_AUDIO_IN, len(frame)) + frame)
        enviados += 1
        # ritmo de tiempo real
        objetivo = t0 + enviados * (FRAME_MS / 1000.0)
        retraso = objetivo - time.monotonic()
        if retraso > 0:
            time.sleep(retraso)

    if args.fin_de_turno:
        print("Enviando 0x03 fin de turno")
        sock.sendall(struct.pack("<BI", MSG_END_TURN, 0))

    print("Listo: %d chunks enviados. Esperando la respuesta (%d s)..."
          % (enviados, args.espera))
    time.sleep(args.espera)
    estado["cerrando"] = True
    sock.close()


if __name__ == "__main__":
    main()
