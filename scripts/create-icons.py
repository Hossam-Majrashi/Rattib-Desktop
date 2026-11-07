"""Generate the committed application icons with Python's standard library."""
import pathlib
import struct
import zlib


def png(size):
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x * 1024 / size, y * 1024 / size
            cx = max(0, 165 - min(px, 1023 - px))
            cy = max(0, 165 - min(py, 1023 - py))
            inside = not (cx and cy and cx * cx + cy * cy > 165 * 165)
            bar = ((235 < px < 355 and 215 < py < 810)
                   or (340 < px < 720 and 215 < py < 335)
                   or (340 < px < 720 and 450 < py < 570)
                   or (620 < px < 745 and 300 < py < 490)
                   or (470 < py < 810 and abs(px - (400 + (py - 470) * .95)) < 73))
            color = (10, 39, 32, 255) if inside and bar else ((99, 223, 178, 255) if inside else (0, 0, 0, 0))
            row.extend(color)
        rows.append(b'\x00' + bytes(row))

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
            + chunk(b'IEND', b''))


root = pathlib.Path(__file__).resolve().parent.parent / 'assets'
root.mkdir(exist_ok=True)
(root / 'icon.png').write_bytes(png(1024))
small = png(256)
(root / 'icon.ico').write_bytes(struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(small), 22) + small)
